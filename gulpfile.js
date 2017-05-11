/*
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

'use strict';

// Include Gulp & tools we'll use
const gulp               = require('gulp');
const $                  = require('gulp-load-plugins')();
const del                = require('del');
const runSequence        = require('run-sequence');
const browserSync        = require('browser-sync');
const reload             = browserSync.reload;
const merge              = require('merge-stream');
const path               = require('path');
const fs                 = require('fs');
const glob               = require('glob');
const historyApiFallback = require('connect-history-api-fallback');
const packageJson        = require('./package.json');
const crypto             = require('crypto');
// const polybuild          = require('polybuild');
const gulpMatch          = require('gulp-match'); // used to ignore transpiling min.js files
const cache              = require('gulp-cache'); // 'gulp clear' task added 3/27/2017




const AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'opera >= 23',
  'ios >= 7',
  'android >= 4.4',
  'bb >= 10'
];

var styleTask = function (stylesPath, srcs) {
  return gulp.src(srcs.map(function(src) {
      return path.join('app', stylesPath, src);
    }))
    .pipe($.changed(stylesPath, {extension: '.css'}))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(gulp.dest('.tmp/' + stylesPath))
    .pipe($.cssmin())
    .pipe(gulp.dest('dist/' + stylesPath))
    .pipe($.size({title: stylesPath}));
};



// Transpile all JS to ES5.
gulp.task('js', function () {

  // using an array of globs threw errors in gulp-if and gulp-match
  // so had to break them out individually in this function
  var isESNextCode = function (file) {
    var isJS = gulpMatch(file, '*.js');
    var isMin = gulpMatch(file, '*.min.js');
    var isWorkerExif = gulpMatch(file, '**/worker-exif.js');

    return (isJS && !isMin && !isWorkerExif);
  };

  return gulp.src('app/**/*.{js,html}')
    .pipe($.sourcemaps.init())
    .pipe($.if('*.html', $.crisper({
      scriptInHead: false
    }))) // Extract JS from .html files
    // .pipe($.if('*.js', $.babel({
    .pipe($.if(isESNextCode, $.babel({
      presets: ['es2015', 'stage-0'],
      plugins: ['transform-regenerator', 'syntax-async-functions']
    })))
    .pipe($.sourcemaps.write('.'))
    .pipe(gulp.dest('.tmp/'))
    .pipe(gulp.dest('dist/'));
});


// Compile and automatically prefix stylesheets
gulp.task('styles', function () {
  return styleTask('styles', ['**/*.css']);
});

gulp.task('elements', function () {
  return styleTask('elements', ['**/*.css']);
});

// Lint JavaScript
gulp.task('jshint', function () {
  return gulp.src([
      'app/scripts/**/*.js',
      '!app/scripts/**/*.min.js', // ignore minified third party files
      'app/elements/**/*.js',
      'app/elements/**/*.html',
      'gulpfile.js'
    ])
    .pipe(reload({stream: true, once: true}))
    .pipe($.jshint.extract()) // Extract JS from .html files
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish'))
    .pipe($.if(!browserSync.active, $.jshint.reporter('fail')));
});


// Optimize images
gulp.task('images', function () {
  return gulp.src('app/images/**/*')
    .pipe($.cache($.imagemin({
      progressive: true,
      interlaced: true
    })))
    .pipe(gulp.dest('dist/images'))
    .pipe($.size({title: 'images'}));
});


// fixes bug where images/touch arent being carried over to dist
// caused by an issue with image caching
// 3/27/2017
gulp.task('clear', done => cache.clearAll(done));


// Copy all files at the root level (app)
gulp.task('copy', function () {
  var app = gulp.src([
    'app/*',
    '!app/test',
    '!app/cache-config.json'
  ], {
    dot: true
  }).pipe(gulp.dest('dist'));

  var bower = gulp.src(['bower_components/**/*'])
    .pipe(gulp.dest('dist/bower_components'));

  var elements = gulp.src(['app/elements/**/*.html'])
    .pipe(gulp.dest('dist/elements'));

  // sw helper files
  var swBootstrap = gulp.src(['bower_components/platinum-sw/bootstrap/*.js'])
    .pipe(gulp.dest('dist/elements/bootstrap'));
    // must move bootstrap folder into elements after vulcanizing them separately
    // from index.html
    // .pipe(gulp.dest('dist/bootstrap'));



  var swToolbox = gulp.src(['bower_components/sw-toolbox/*.js'])
    .pipe(gulp.dest('dist/sw-toolbox'));

  // var vulcanized = gulp.src(['app/elements/elements.html'])
  //   // lazy loading elements via app.js so we dont need to 
  //   // create the elements.vulcanized.html file anymore
  //   // .pipe($.rename('elements.vulcanized.html'))
  //   .pipe(gulp.dest('dist/elements'));

  // return merge(app, bower, elements, vulcanized, swBootstrap, swToolbox)
  //   .pipe($.size({title: 'copy'}));

  return merge(app, bower, elements, swBootstrap, swToolbox)
    .pipe($.size({title: 'copy'}));
});

// Copy web fonts to dist
gulp.task('fonts', function () {
  return gulp.src(['app/fonts/**'])
    .pipe(gulp.dest('dist/fonts'))
    .pipe($.size({title: 'fonts'}));
});

// Scan your HTML for assets & optimize them
gulp.task('html', function () {
  var assets = $.useref.assets();

  return gulp.src(['dist/**/*.html', '!dist/{elements,test}/**/*.html'])

    // no longer needed since elements are being lazyloaded after check for
    // web component support in app.js
    // Replace path for vulcanized assets
    // .pipe($.if('*.html', $.replace('elements/elements.html', 'elements/elements.vulcanized.html')))

    .pipe(assets)
    // Concatenate and minify JavaScript
    .pipe($.if('*.js', $.uglify({preserveComments: 'some'})))
    // Concatenate and minify styles
    // In case you are still using useref build blocks
    .pipe($.if('*.css', $.cssmin()))
    .pipe(assets.restore())
    .pipe($.useref())
    // Minify any HTML
    .pipe($.if('*.html', $.minifyHtml({
      quotes: true,
      empty: true,
      spare: true
    })))
    // Output files
    .pipe(gulp.dest('dist'))
    .pipe($.size({title: 'html'}));
});

// need seperate 'remaining-scripts' task since the build only catches app.js
// run scripts through uglify 
gulp.task('remaining-scripts', function () {
  return gulp.src(['dist/scripts/*.js', '!dist/scripts/app.js', '!dist/scripts/*.min.js'])
    // Concatenate and minify JavaScript
    .pipe($.uglify({preserveComments: 'some'}))
    .pipe(gulp.dest('dist/scripts'));
});



// polybuild/vulcanize breaks firebase.js
// https://github.com/PolymerElements/polymer-starter-kit/issues/378

// // Polybuild will take care of inlining HTML imports,
// // scripts and CSS for you.
// gulp.task('vulcanize-elements', function () {
//   return gulp.src('dist/elements/elements.html')
//     .pipe(polybuild({maximumCrush: true}))
//     .pipe(gulp.dest('dist/elements'));
// });


// polybuild/vulcanize break firebase.js so exclude it
// https://github.com/PolymerElements/polymer-starter-kit/issues/378

// Polybuild will take care of inlining HTML imports,
// scripts and CSS for you.
gulp.task('vulcanize-elements', function () {
  return gulp.src('dist/elements/elements.html')
    .pipe($.vulcanize({
      stripComments: true,
      inlineCss: true,
      inlineScripts: true,
      excludes: [path.resolve('./dist/bower_components/firebase/firebase.js')]
    }))
    .pipe(gulp.dest('dist/elements'));
});









// If you require more granular configuration of Vulcanize
// than polybuild provides, follow instructions from readme at:
// https://github.com/PolymerElements/polymer-starter-kit/#if-you-require-more-granular-configuration-of-vulcanize-than-polybuild-provides-you-an-option-by

// Rename Polybuild's elements.build.html to elements.html
gulp.task('rename-elements', function () {
  gulp.src('dist/elements/elements.build.html')
    .pipe($.rename('elements.html'))
    .pipe(gulp.dest('dist/elements'));
  return del(['dist/elements/elements.build.html']);
});


// clean up uneeded files that are already merged into app.js after the build process
// so that they do not appear in cache-config
// must also remove these files from the file list used by the cache-config task
// by filtering the array off cache files 
gulp.task('delete-merged-with-appjs', function () {
  return del(['dist/scripts/babel-polyfill.min.{js,js.map}']);
});



// Generate config data for the <sw-precache-cache> element.
// This include a list of files that should be precached, as well as a (hopefully unique) cache
// id that ensure that multiple PSK projects don't share the same Cache Storage.
// This task does not run by default, but if you are interested in using service worker caching
// in your project, please enable it within the 'default' task.
// See https://github.com/PolymerElements/polymer-starter-kit#enable-service-worker-support
// for more context.
gulp.task('cache-config', function (callback) {
  var dir = 'dist';
  var config = {
    cacheId: packageJson.name || path.basename(__dirname),
    disabled: false
  };

  glob('{elements,images,scripts,styles}/**/*.*', {cwd: dir}, function(error, files) {
  // ignore dist/elements/elements.build.html that polybuild creates
  // it is replaced with dist/elements/elements.html then deleted in the 'rename-elements' task
  // so it 404's which kills service worker
  // glob('{elements,images,scripts,styles}/**/!(elements.build.html)', {cwd: dir}, function(error, files) {
    if (error) {
      callback(error);
    } else {

      files.push(
        'index.html', 
        './', 
        'bower_components/webcomponentsjs/webcomponents-lite.min.js', 
        'bower_components/parse/parse.min.js'
      );

      // must remove these files from the array since they dont exist in the build version of the
      // scripts folder even though the files are removed in the 'delete-merged-with-appjs' task
      const filteredFiles = files.filter(file => file !== 'scripts/babel-polyfill.min.js' && 
                                                 file !== 'scripts/babel-polyfill.min.js.map' &&
                                                 file !== 'elements/elements.build.html');

      // config.precache = files;
      config.precache = filteredFiles;

      var md5 = crypto.createHash('md5');
      md5.update(JSON.stringify(config.precache));
      config.precacheFingerprint = md5.digest('hex');

      var configPath = path.join(dir, 'cache-config.json');
      fs.writeFile(configPath, JSON.stringify(config), callback);
    }
  });
});

// Clean output directory
gulp.task('clean', function (cb) {
  del(['.tmp', 'dist'], cb);
});

// Watch files for changes & reload
gulp.task('serve', ['styles', 'elements', 'images', 'js'], function () {
  browserSync({
    port: 5000,
    notify: false,
    logPrefix: 'PSK',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function (snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: {
      baseDir: ['.tmp', 'app'],
      middleware: [ historyApiFallback() ],
      routes: {
        '/bower_components': 'bower_components'
      }
    }
  });

  gulp.watch(['app/**/*.html'], ['js', reload]);
  gulp.watch(['app/styles/**/*.css'], ['styles', reload]);
  gulp.watch(['app/elements/**/*.css'], ['elements', reload]);
  gulp.watch(['app/{scripts,elements}/**/*.js'], ['jshint', 'js']);
  gulp.watch(['app/images/**/*'], reload);
});

// Build and serve the output from the dist build
gulp.task('serve:dist', ['default'], function () {
  browserSync({
    port: 5001,
    notify: false,
    logPrefix: 'PSK',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function (snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: 'dist',
    middleware: [ historyApiFallback() ]
  });
});

// // Build production files, the default task
// gulp.task('default', ['clean'], function (cb) {
//   // Uncomment 'cache-config' after 'rename-index' if you are going to use service workers.
//   runSequence(
//     ['copy', 'styles'],
//     ['elements', 'js'],
//     ['jshint', 'images', 'fonts', 'html'],
//     'vulcanize-elements', 'rename-elements', 'cache-config',
//     cb);
// });


// Build production files, the default task
// added 'clear' task 3/29/2017 because images/touch were not being picked up by build
// caused by an error in gulp-cache
gulp.task('default', ['clean', 'clear'], function (cb) {
  // Uncomment 'cache-config' after 'rename-index' if you are going to use service workers.
  runSequence(
    ['copy', 'styles'],
    ['elements', 'js'],
    // added 'remaining-scripts' 8/29/2016
    ['jshint', 'images', 'fonts', 'html', 'remaining-scripts'],
    // added 'delete-merged-with-appjs' 9/1/2016
    'vulcanize-elements', 'rename-elements', 'delete-merged-with-appjs', 'cache-config',
    cb);
});


// Load tasks for web-component-tester
// Adds tasks for `gulp test:local` and `gulp test:remote`
require('web-component-tester').gulp.init(gulp);

// Load custom tasks from the `tasks` directory
try { require('require-dir')('tasks'); } catch (err) {}
