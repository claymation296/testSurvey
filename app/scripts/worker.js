// worker thread



(function(self) {

	self.importScripts('../bower_components/parse/parse.min.js', 'worker-exif.js', 'worker-jimp.min.js');
	// Self.importScripts('../bower_components/parse/parse.js', 'worker-exif.js');

	const Self = Object.freeze(self);
	const Db 	 = Self.Parse; 
	const Exif = Self.Exif;
	// github oliver-moran/jimp
	const Jimp = Self.Jimp;
	// output quality of image processing, int 0-100
	const imageQualitySetting = 20;


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

	// listen for a response from web-worker.html for 
	// async calls to main thread localstorage
	// must use Parse.Promise for SDK compatibility
	const awaitResponseWithParsePromise = job => {
		const promise = new Db.Promise(resolve => {

	    const response = event => {
	      const jobRes = event.data;

	      if (jobRes.func === job.func) {
	      	// compare event key with the one that was used when the promise
          // was originally called via closure
          const isNotMatchingKey = jobRes.key !== job.key;
          // ignore the event if its not the one that matches the key
          if (isNotMatchingKey) { return; }

	        Self.removeEventListener('message', response, false);
	        resolve(jobRes.item);
	      }
	    };

	    Self.addEventListener('message', response, false);
	  });

  	return promise;
	};


	// custom async storage controller for Parse JS SDK
	const asyncWorkerStorageController = {
		async: 1,

		getItemAsync(path) {
			const getItemJob = {func: 'dbGetItemAsync', key: path, path};
			successful(getItemJob);
			// return a promise that resolves when web-worker.html returns the item from localstorage
			// response = {func, key, path, item}
			return awaitResponseWithParsePromise(getItemJob);
		},

		setItemAsync(path, value) {
			const setItemJob = {func: 'dbSetItemAsync', path, value};
			successful(setItemJob);

			return Db.Promise.as('item set');
		},

		removeItemAsync(path) {
			const removeItemJob = {func: 'dbRemoveItemAsync', path};
			successful(removeItemJob);

			return Db.Promise.as('item removed');
		},

		clear() {
			const clearJob = {func: 'dbClearLocalstorage'};
			successful(clearJob);

			return Db.Promise.as('localstorage cleared');
		}

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
		const list = {};

		return {
			get() {
				return list;
			},

			add(job) {
				list[job.key] = job;
			},

			remove({key}) {
				delete list[key];
			},

			clear() {
				for(const key in list) {
					this.remove({key});
				}
			}
		};
	};

	// cache the job that is currently being processed between 'photo' and 'fileUpload' funcs
	const waiting  = privateList();
	// cache failed jobs with files removed
	const dreading = privateList();


	const getBatch = () => {
		const offlineBatchJob = {func: 'getBatch'};
		successful(offlineBatchJob);
	};


	const removeSavedFromQueue = jobs => {
		const removeJob = {func: 'removeSaved'};
		successful(removeJob, jobs);

		const promise = new Promise(resolve => {
	    const response = event => {
	      const job = event.data;
	      if (job.func === 'removeDone') {
	        Self.removeEventListener('message', response, false);
	        resolve(job.length);
	      }
	    };

	    Self.addEventListener('message', response, false);
	  });

  	return promise;		
	};

	// listen for a response from web-worker.html for a given job
	// takes a job with at least a func and a key
	const awaitResponse = job => {
		const promise = new Promise(resolve => {

	    const response = event => {
	      const jobRes = event.data;

	      if (jobRes.func === job.func) {
	      	// compare event key with the one that was used when the promise
          // was originally called via closure
          const isNotMatchingKey = jobRes.key !== job.key;
          // ignore the event if its not the one that matches the key
          if (isNotMatchingKey) { return; }

	        Self.removeEventListener('message', response, false);
	        resolve(jobRes);
	      }
	    };

	    Self.addEventListener('message', response, false);
	  });

  	return promise;
	};


	const getNewUrl = job => {
		// job === {func: 'getUrl', key, fileKey}
		const fetchFileJob = Object.assign({}, job, {func: 'fileForUrl'});
		successful(fetchFileJob);

		return awaitResponse(fetchFileJob);
	};


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


	const processFile = file => {
		const mime 	 = file.type;
 		const reader = new FileReader(); 
    reader.readAsArrayBuffer(file);

    const promise = new Promise((resolve, reject) => {
    	reader.onload = () => {
    		if (reader.error) {
    			reject(reader.error);
    		}

    		Jimp.read(reader.result).
    			then(image => {
    				image.quality(imageQualitySetting).getBuffer(mime, (err, processedBuffer) => {
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


  const makeJobsArray = obj => Object.keys(obj).map(key => obj[key]);

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


  const processQueue = () => {
		if (canProcessQueue()) {
			getBatch();
		}
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
				// must use null for iron-localstorage
				successful(job, null);
			}, error => {
				errored(job, error);
			});
	};
	// cache job then return url and orientation
	// must get orientation data first because the exif data is destroyed
	// by image processing library
  const photo = job => {
  	// job === {extension, file, fileName, funk, key}
  	let {extension, file, fileName, key} = job;
  	const blobName = file.name;
  	const url  		 = Self.URL.createObjectURL(file);

  	getOrientation(job).
  		then(orientation => {
  			// dont send file back to main thread for better perf
  			const jobWithoutFile = removeFile(job);
  			// return key, orientation and url back to photo-capture via web-worker
  			successful(jobWithoutFile, {key, orientation, url});

  			processFile(file).
  				then(blob => {
  					// newly processed data waiting to be saved to cloud
		  			const waitingListJob = {
		  				extension,
		  				blob,
		  				fileName,
		  				func: 'fileProcessed',
		  				key
		  			};
		  			// do not include the blob in the job obj
		  			const fileProcessedJob = {func: 'fileProcessed', key};
		  			// cache each job for fileUpload
		  			waiting.add(waitingListJob);
		  			// save processed file to localForage
		  			successful(fileProcessedJob, {blob, blobName, extension, fileName, key});
					}).
	  			// using a seperate catch handler to avoid uncaught errors in main-thread
	  			// caused from a race condition with the messaging sytem
		  		catch(error => {
		  			errored({func: 'fileProcessed', key}, error);
		  		});
  		}).
  		catch(error => {
  			errored(job, error);
  		});
	};


	const fileUpload = jobsObj => {
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
			const dreadingList = dreading.get();

			uploadedJobs.forEach(job => {
				const jobIsOnDreadingList = (dreadingList[job.key]);

				if (jobIsOnDreadingList) {
					const resolvedJob = renameFunc(job, 'resolved');
					successful(resolvedJob);
					dreading.remove(resolvedJob);
				} else {
					const savedJob = renameFunc(job, 'savePhoto');
					// send entire job as output because it is used to properly
					// save the data into the userSelectedArray
					successful(savedJob, job);
					waiting.remove(savedJob);
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
				processQueue();
			}
    };

    const handleErrors = error => {
    	currentlyUploading 		 = false;
    	const jobsWithoutFiles = jobs.map(removeFile);
    	const connectionLost 	 = error.code ? (error.code === 100) : false;

    	if (connectionLost) {
    		// remove failed attempts from waiting list and add them to dreading list
    		jobsWithoutFiles.forEach(job => {
    			const failedJob = renameFunc(job, 'savePhoto');
    			waiting.remove(failedJob);
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


	const getUrl = job => {
		// job === {func: 'getUrl', key, fileKey}
		getNewUrl(job).
			then(({blob}) => blob ? Self.URL.createObjectURL(blob) : undefined).
			then(url => successful(job, url)).
			catch(error => errored(job, error.message));
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
			case 'getCurrentUser':
				getCurrentUser();
				break;
			case 'login':
				login(job);
				break;
			case 'signup':
				signup(job);
				break;
			case 'logout':
				logout(job);
				break;
			case 'photo':
				photo(job);
				break;
			case 'savePhoto':
				fileUpload(waiting.get());
				break;
			case 'batch':
				fileUpload(job.jobsObj);
				break;
			case 'getUrl':
				getUrl(job);
				break;
			case 'pricing':
				pricing(job);
				break;
			case 'save':
				save(job);
				break;
			case 'processQueue':
				// for devices that dont receive online event
				// trigger the photo upload process for any images stored in localforage
				// before allowing user to send bom
				processQueue();
				break;
			case 'sendBom':
				sendBom(job);
				break;
			case 'search':
				surveySearch(job);
				break;
			case 'removeDone':
			case 'fileForUrl':
			case 'dbGetItemAsync':
				// nothing to do here because these events are listened for in a seperate function
				break;

			default:
				throw new Error('worker function not found in worker.js');
		}
	};


	// listen for online event and cycle through the queue if necessary
	Self.addEventListener('online', processQueue, false);


}(self)); // jshint ignore:line

