// worker thread



(function(self) {

	self.importScripts(
		'../bower_components/localforage/dist/localforage.min.js', 
		'../bower_components/parse/parse.min.js', 
		'worker-exif.js', 
		'worker-jimp.min.js'
	);

	const Self = Object.freeze(self);
	const Lf   = Self.localforage;
	const Db 	 = Self.Parse; 
	const Exif = Self.Exif;
	// github oliver-moran/jimp
	const Jimp = Self.Jimp;
	
	const IMAGE_SIZE    = 512;
	// output quality of image processing, int 0-100
	const IMAGE_QUALITY = 60;
	// number of photos to simultaneously upload to db
	const PHOTO_UPLOAD_BATCH_SIZE = 3;
	// must have seperate localforage instance for blobs because
  // they will only save properly if they are at the top level
  // blobs dont save when nested inside an object
	const parseLocalforage = Lf.createInstance({name: 'REDAAP-Parse'});
	const jobLocalforage   = Lf.createInstance({name: 'REDAAP-Jobs'});
  const blobLocalforage  = Lf.createInstance({name: 'REDAAP-Blobs'});




	const successful = (job, output) => {
		job.output 		 = output;
		const response = {job, status: 'success'};
		Self.postMessage(response); 
	};


	const errored = (job, error) => {
		job.output 		 = error;
		const response = {job, status: 'error'};
		Self.postMessage(response);
	};

	// specifically for debugging safari which does not console.log from worker context
	const log = (...message) => {
		successful({func: 'log'}, message);
	};

	// custom async storage controller for Parse JS SDK to localforage integration
	const asyncWorkerStorageController = {
		async: 1,

		getItemAsync: 	 path => 
											 new Db.Promise((resolve, reject) => 
												 parseLocalforage.
												 	 getItem(path).
												 	 then(item => 
													 	 resolve(item)).
												 	 catch(err => 
													 	 reject(err))),

		setItemAsync: 	 (path, value) => 
											 new Db.Promise((resolve, reject) =>
												 parseLocalforage.
												 	 setItem(path, value).
												 	 then(() => 
													 	 resolve('item set')).
												 	 catch(err => 
												 	 	 reject(err))),

		removeItemAsync: path => 
											 new Db.Promise((resolve, reject) =>
										 	 	 parseLocalforage.
										 	 	 	 removeItem(path).
										 	 	 	 then(() => 
										 	 	 	 	 resolve('item removed')).
										 	 	 	 catch(err => 
										 	 	 	 	 reject(err))),

		clear: 					 () => 
					 	 					 new Db.Promise((resolve, reject) =>
							 				 	 parseLocalforage.
							 				 	 	 clear().
							 				 	 	 then(() => 
							 	 					 	 resolve('localstorage cleared')).
							 				 	 	 catch(err => 
							 				 	 	 	 reject(err)))
	};

	// start Parse Server Api
	// used to correct missing localstorage support inside worker environment
	Db.CoreManager.setStorageController(asyncWorkerStorageController);
	Db.initialize('tY6Sbi9gcEzSqfNWXydt6pkAliMCUnT2fs8OVYAe');


	Db.serverURL = 'https://test.redaap.net/parse'; // test
	// Db.serverURL = 'https://redaap.net/parse'; 	// production




	// initial setting
	let currentlyUploading = false;

	const normalizeEmail 	= email => email.trim().toLowerCase();

	const canProcessQueue = () => !currentlyUploading && Self.navigator.onLine;


	const privateList = () => {
		// list === {key: job}
		let list = {};

		return {
			get({key}) {
				return list[key];
			},

			getAll() {
				return list;
			},

			add(job) {
				list[job.key] = job;
			},

			remove({key}) {
				delete list[key];
			},

			clear() {
				list = {};
			}
		};
	};

	// cache the job that is currently being processed between 'photoMetadata' and 'processPhoto' funcs
	const waiting  = privateList();
	// cache failed jobs with files removed
	const dreading = privateList();



	// use exif.js library to get image orientation
  const getOrientation = ({file, extension}) => {
    const promise = new Promise((resolve, reject) => {
    	if (extension === 'jpg' || extension === 'jpeg') {
    		Exif.getData(file, () => { 
	        const orient = Exif.getTag(file, 'Orientation');
	        if (orient) {
	        	resolve(orient);
	        } else {
	        	reject('could not get orientation data');
	        }
	      });
    	} else {
    		resolve(undefined);
    	}
    });

    return promise;
  };


	const processFile = (file, orientation) => {
		const mime 	 = file.type;
    const width  = (orientation === 6 || orientation === 8) ? Jimp.AUTO : IMAGE_SIZE;
    const height = (orientation === 6 || orientation === 8) ? IMAGE_SIZE : Jimp.AUTO;
 		const reader = new FileReader(); // Jimp does not accept raw files
    reader.readAsArrayBuffer(file);

    const promise = new Promise((resolve, reject) => {
    	reader.onload = () => {
    		if (reader.error) {
    			reject(reader.error);
    		}

    		Jimp.read(reader.result).
    			then(image => {

    				image.
    					resize(width, height).
    					quality(IMAGE_QUALITY).
    					getBuffer(mime, (err, processedBuffer) => {
    					if (err) {
    						reject(err);
    					}
	    				const blob = new Blob([processedBuffer], {type: mime});
	    				resolve(blob);
    				});
    			}).
    			catch(error => {
		  			reject(error);
		  		});
	    };
    });

 		return promise;
	};


 	const saveOffline = (value, blob) => {
 		const {key} = value;

 		const setJobAndFilePromises = [
      jobLocalforage.setItem(key,  value), 
      blobLocalforage.setItem(key, blob)
    ];

    return Promise.all(setJobAndFilePromises).
    	then(() => blob);
 	};

  // filter out waiting objects that have not been processed yet
  const makeJobsArray = obj => Object.keys(obj).
  															 map(key => obj[key]).
  															 filter(job => job.hasOwnProperty('blob'));
  															 
  // helper function to create the image file name from fixture.label dynaically
	const makeFileNamePrefix = str => str.replace(/\s+|\/+|\"+|\-+|\(+|\)+/g, '').toLowerCase();

	// must save all images directly then associate them to a Db.Object in the cloud func
  const fileSave = (blob, prefix) => {
    // ie image/jpg --> 'jpg'
    const fileExtension = blob.type.split('/')[1];
    const fileName 			= `${prefix}.${fileExtension}`;
    // Parse throws an error in ios when attempting to 
    // pass the raw file object into Parse.File ie. ParseFile(fileName, file);
    // but base64 and FileReader() work
    const reader  = new FileReader(); 
    reader.readAsDataURL(blob);

    const promise = new Promise((resolve, reject) => {
    	reader.onload = () => {
    		if (reader.error) {
    			reject(reader.error);
    		}
	    	const dataURL = reader.result;
	    	const base64  = dataURL.split(',')[1];
	    	const dbFile 	= new Db.File(fileName, {base64});
		    // Db save() method returns a promise
	    	resolve(dbFile.save());
	    };
    });

    return promise;
  }; 

  // build an array of promises that will run in parallel through Promise.all
	const fileSavePromises = jobs => {
		const saves = jobs.map(({blob, fileName}) => {
    	// fileName === existingFixture.label ie. '2ft T8/T12'
    	const fileNamePrefix = makeFileNamePrefix(fileName);
      const filePromise 	 = fileSave(blob, fileNamePrefix);
      return filePromise;
    });
    return saves;
	};

  
  const renameFunc = (job, name) => Object.assign({}, job, {func: name});

  // allow gc of file asap
	const removeFile = job => Object.assign({}, job, {blob: undefined, file: undefined});

	// assign the newly returned url and name to each job
	const addSavedDataAndRemoveFiles = (jobs, saved) => {

		const data = index => {
			const {_name, _url} = saved[index];
			
			return {
				savedName: _name,
				savedUrl:  _url
			};
		};

		const savedJob = (job, index) => Object.assign(data(index), removeFile(job));

		return jobs.map(savedJob);
	};


	const getBatch = () => {
    const blobPromises   = [];
    const values         = []; // value === {func, blobName, fileName, key, extension}

    const storeValuesAndMakeBlobPromises = (value, key, iteration) => {
      blobPromises.push(blobLocalforage.getItem(key));
      values.push(value);
      // must return something to escape out of the iterator early
      if (iteration === PHOTO_UPLOAD_BATCH_SIZE) { return blobPromises; }
    };

    const getBlobs  = (promises = blobPromises) => Promise.all(promises);
    
    const makeJobs  = blobs => 
                        blobs.map((blob, index) => 
                          Object.assign({blob}, values[index]));

    const makeBatch = jobs => {
			const batch = jobs.reduce((accumulator, job) => {
        accumulator[job.key] = job;
        return accumulator;
			}, {});

      return batch;
    };

    // iterate over stored jobs
    return jobLocalforage.
      iterate(storeValuesAndMakeBlobPromises).
      then(getBlobs).
      then(makeJobs).
      then(makeBatch);          
	};


	const removeSavedFromQueue = jobs => {
		const removeItemPromises = jobs.map(job => [
			jobLocalforage.removeItem(job.key),
      blobLocalforage.removeItem(job.key)
		]);

    const getLocalForageLength = () => jobLocalforage.length();
    
    return Promise.all(removeItemPromises).
      then(getLocalForageLength);	
	};





//******************** main functions ****************************************






	// get current user after localstorage initializes and pass it to web-worker.html
	// must use .currentAsync since all localstorage operations are promised based
	const getCurrentUser = () => {
		Db.User.currentAsync().
			then(currentUser => {
				const currentUserJob = {func: 'user'};
				if (currentUser) {
					successful(currentUserJob, currentUser.attributes);
				} else {
					successful(currentUserJob, null);
				}
			});
	};


	const login = job => {
		const {email, password} = job;
		const normalizedEmail 	= normalizeEmail(email);
		Db.User.logIn(normalizedEmail, password).
			then(user => {
				// clear pw so it is guaranteed to not be displayed accidentally
				job.password = '';
				successful(job, user.attributes);
			}, error => {
				errored(job, error);
			});
	};


	const signup = job => {
		const {email, password} = job;
		const normalizedEmail   = normalizeEmail(email);
		Db.Cloud.run('signup', {email: normalizedEmail, password}).
			// must use .become method since user is initially set on the back end
      then(response => {
      	// added enableUnsafeCurrentUser after db migration and sdk update 1/11/2017
      	Db.User.enableUnsafeCurrentUser();
      	return Db.User.become(response.attributes.sessionToken);
      }).
			then(user => {
				successful(job, user.attributes);
			}, error => {
				errored(job, error);
			});
	};


	const logout = job => {
		Db.User.logOut().
			then(() => {
				// clear photo job cache
				waiting.clear();
				dreading.clear();

				const clearBoth = [jobLocalforage.clear(), blobLocalforage.clear()];

        return Promise.all(clearBoth);
      }).
      then(() => {
				// must use null for iron-localstorage
				successful(job, null);
			}, error => {
				errored(job, error);
			});
	};
	// cache job then return url and orientation
	// must get orientation data first because the exif data is destroyed
	// by image processing library
  const photoMetadata = job => {
  	// job === {extension, file, fileName, func, key}
  	getOrientation(job).
  		then(orientation => {
  			// waiting to be processed and saved to localforage
  			// cache each job for file processing
  			waiting.add(job);

  			const {file, key} = job;
  			const url = Self.URL.createObjectURL(file);
  			// dont send file back to main thread for better perf
  			const jobWithoutFile = removeFile(job);
  			// return key, orientation and url back to photo-capture via web-worker
  			successful(jobWithoutFile, {key, orientation, url});  			
  		}).
  		catch(error => {
  			errored(job, error);
  		});
	};


  const processPhoto = job => {
		const {extension,	file,	fileName, key, orientation} = waiting.get(job);
  	const blobName = file.name;
  	waiting.remove(job);

		processFile(file, orientation).
			then(blob => {
				// newly processed data waiting to be saved to cloud
  			const offlineJob = {blobName, extension, fileName, key};
  			return saveOffline(offlineJob, blob);
  		}).
  		then(blob => {



  			log('processed file size: ', blob.size);


				// send back a new temp url based on compressed image file
				// to maintain a small browser cache
				const url = Self.URL.createObjectURL(blob);

  			successful(job, {key, orientation: 0, url});
			}).
			// using a seperate catch handler to avoid uncaught errors in main-thread
			// caused from a race condition with the messaging sytem
  		catch(error => {
  			errored(job, error);
  		});
  };


	const photoUpload = jobsObj => {
		// job === {func, blob, fileName, key, extension}
		currentlyUploading = true;

		let uploadedJobs;
		const jobs = makeJobsArray(jobsObj);
		// empty object passed in so there is no work to be done
		if (!jobs.length) { return; }
		
    const savePromises = fileSavePromises(jobs);

    const associateFiles = uploaded => {
  		uploadedJobs = addSavedDataAndRemoveFiles(jobs, uploaded);
  		// send saved photo url and file name back into cloud function
  		// that will associate the files with an object for later recall
      return Db.Cloud.run('photos', {uploaded});
		};

		const completeSuccessfulSaves = () => {
			const dreadingList = dreading.getAll();

			uploadedJobs.forEach(job => {
				const jobIsOnDreadingList = (dreadingList[job.key]);

				if (jobIsOnDreadingList) {
					const resolvedJob = renameFunc(job, 'resolved');
					successful(resolvedJob);
					dreading.remove(resolvedJob);
				} else {
					const savedJob = renameFunc(job, 'photoUpload');
					// send entire job as output because it is used to properly
					// save the data into the userSelectedArray
					successful(savedJob, job);
				}
			});

			currentlyUploading = false;
			// done uploading so remove successful jobs from localforage queue
			// and return the new queue length
			return removeSavedFromQueue(uploadedJobs);
		};

		const checkQueue = queueLength => {
			// check the queue in case user has added more photos while uploading
			if (queueLength) {
				getBatch().
					then(batch => photoUpload(batch)).
					catch(error => log(error));
			}
    };

    const handleErrors = error => {
    	currentlyUploading 		 = false;
    	const jobsWithoutFiles = jobs.map(removeFile);
    	const connectionLost 	 = error.code ? (error.code === 100) : false;

    	if (connectionLost) {
    		// add failed attempts to dreading list
    		jobsWithoutFiles.forEach(job => {
    			const failedJob = renameFunc(job, 'photoUpload');
    			dreading.add(failedJob);
    			errored(failedJob, 'connection lost');
    		});

    		return;
    	}
    	
    	jobsWithoutFiles.forEach(job => {
    		errored(job, error.message);
    	});      	
    };

    Promise.all(savePromises).
    	then(associateFiles).
			then(completeSuccessfulSaves).
			then(checkQueue).
      catch(handleErrors);
	};


  const processQueue = () => {
		if (canProcessQueue()) {
			getBatch().
				then(batch => photoUpload(batch)).
				catch(error => log(error));
		}
	};


	const getUrl = job => {
		// job === {func: 'getUrl', key, fileKey}
		blobLocalforage.
      getItem(job.fileKey).
      then(blob   => blob ? Self.URL.createObjectURL(blob) : undefined).
			then(url 		=> successful(job, url)).
			catch(error => errored(job, error.message));
	};


	const revokeUrl = job => {
		Self.URL.revokeObjectURL(job.url);
	};


	const clearPhotos = () => {
		waiting.clear();
		dreading.clear();
		jobLocalforage.clear();
    blobLocalforage.clear();
	};


	const deletePhoto = job => {
		waiting.remove(job);
		dreading.remove(job);
		jobLocalforage.removeItem(job.key);
    blobLocalforage.removeItem(job.key);
	};


	const pricing = job => {
		// for devices that dont receive online event
		processQueue();

		Db.Cloud.run('pricing', {data: job.uSA}).
			then(pricing => {
				const uSA  = Array.of(...job.uSA);
				const data = {uSA, pricing};
				job.uSA 	 = undefined;
				successful(job, data);
			}, error => {
				errored(job, error);
			});
	};


	const save = job => {
		// type from email-options
		// type === 'save'/'review'/'send'
		// options === {brochure: bool, credit: bool, contract: bool, capture: dataURL}
		const {type, options, client, pricing, survey} = job;
    const data = {options, client, survey, pricing};

    Db.Cloud.run(type, {data}).
			then(() => {
				// no need to return client, pricing, survey back to app
				const saveJobSuccess = {func: 'save'};
				successful(job, saveJobSuccess);
			}, error => {
				errored(job, error);
			});
	};


	const sendBom = job => {
		Db.Cloud.run('sendBom', {bom: job.bom, client: job.client}). 
      then(() => {
				const sendBomSuccess = {func: job.func};
        successful(job, sendBomSuccess);
      }, error => {
        errored(job, error);
      });
	};


	const surveySearch = job => {
		Db.Cloud.run('search', job.query). 
      then(response => {
      	// must reassign all attributes keys
      	// since the object's 'get' method 
      	// does not get copied into main thread
      	for (const key in response) {
      		response[key].forEach(entry => {
      			entry.attr = entry.attributes;
      		});
      	}

        successful(job, response);
      }, error => {
        errored(job, error);
      });
	};


	// handle all incoming messages
	Self.onmessage = event => {
		const job  = event.data;
		const func = job.func;

		switch (func) {
			case 'login':
				login(job);
				break;
			case 'signup':
				signup(job);
				break;
			case 'logout':
				logout(job);
				break;
			case 'photoMetadata':
				photoMetadata(job);
				break;
			case 'processPhoto':
				processPhoto(job);
				break;
			case 'photoUpload':
				processQueue();
				break;
			case 'processQueue':
				// for devices that dont receive online event
				// trigger the photo upload process for any images stored in localforage
				// before allowing user to send bom
				processQueue();
				break;
			case 'getUrl':
				getUrl(job);
				break;
			case 'revokeUrl':
				revokeUrl(job);
				break;
			case 'deletePhoto':
				deletePhoto(job);
				break;
			case 'clearPhotos':
				clearPhotos();
				break;
			case 'pricing':
				pricing(job);
				break;
			case 'save':
				save(job);
				break;
			case 'sendBom':
				sendBom(job);
				break;
			case 'search':
				surveySearch(job);
				break;
			default:
				throw new Error('worker function not found in worker.js');
		}
	};


	// listen for online event and cycle through the queue if necessary
	Self.addEventListener('online', processQueue, false);

	getCurrentUser();

}(self)); // jshint ignore:line

