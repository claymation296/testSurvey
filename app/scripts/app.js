/*
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/




(function(document) {
  'use strict';
  // Grab a reference to our auto-binding template
  // and give it some initial binding values
  // Learn more about auto-binding templates at http://goo.gl/Dx1u2g
  const app      = document.querySelector('#app');
  const select   = str => document.querySelector(str);
  const schedule = func => {
    window.setTimeout(() => {
      window.requestAnimationFrame(func);
    }, 1);
  };


  // create a table of custom element objects that will be
  // referenced by other elements for dom manipulation and api calls
  window.Redaap = window.Redaap || {};

  const customElements = {
    accountBadge:   '#accountBadge',
    accountForm:    'account-form',
    appSecurity:    'app-security',
    areaEdit:       'area-edit',
    bomFullscreen:  'bom-fullscreen-edit',
    bomSelector:    'bom-catagory-selector',
    clearDialog:    '#clearDialog',
    drawerPanel:    '#paperDrawerPanel',
    drawerScroll:   '#drawerScroll',
    emailOptions:   'email-options',
    lightSelector:  'light-selector',
    lightingMain:   'lighting-main',
    lightingRipple: 'lighting-mode-ripple',
    loadDialog:     '#loadDialog',
    logoutDialog:   '#logoutDialog',
    mainButtons:    'main-toolbar-buttons',
    mainScroll:     '#mainScroll',
    notesPage:      'notes-page',
    photoViewer:    'photo-viewer',
    quotePage:      'quote-page',
    solutionPage:   'solution-page', 
    successPage:    'success-page',
    surveySearch:   'survey-search',
    webWorker:      'web-worker',
    toast:          '#toast',
    warningToast:   '#warningToast',
    workerDialog:   '#workerDialog'
  };
    

  const getRefs = () => {
    app.removeEventListener('dom-change', getRefs, false);

    for (const key in customElements) {
      window.Redaap[key] = select(customElements[key]);
    }
  };
  
  // wait for the 'dom-bind' template to stamp so children will be in the document
  app.addEventListener('dom-change', getRefs, false);


  app.scrollPageToTop = () => {
    if (window.Redaap.mainScroll) {
      const scroll = () => {
        // paper-scroll-header-panel bug fix
        window.Redaap.drawerScroll.measureHeaderHeight();
        window.Redaap.mainScroll.measureHeaderHeight();
        window.Redaap.mainScroll.scroller.scrollTop = 0;
      };
      
      schedule(scroll);
    }
  };

  // Close drawer after menu item is selected if drawerPanel is narrow
  app.onDataRouteClick = () => {
    if (window.Redaap.drawerPanel.narrow) {
      const closeDrawer = () => {
        window.Redaap.drawerPanel.closeDrawer();
      };

      schedule(closeDrawer);
    }
  };

   app.displayInstalledToast = () => {
    // Check to make sure caching is actually enabled—it won't be in the dev environment.
    if (!select('platinum-sw-cache').disabled) {
      select('#caching-complete').show();
    }
  };


  const setupPaperHeaderTransformListener = () => {
    // Main area's paper-scroll-header-panel custom condensing transformation of
    // the appName in the middle-container and the bottom title in the bottom-container.
    // The appName is moved to top and shrunk on condensing. The bottom sub title
    // is shrunk to nothing on condensing.
    const mainToolbar = select('#mainToolbar');
    // ios does not have these divs stamped out by the time this runs
    // so must define them on first paper-header-transform
    let middleContainer;

    document.body.addEventListener('paper-header-transform', event => {

      const transformHeader = () => {
        if (!middleContainer) {
          middleContainer = Polymer.dom(mainToolbar).querySelector('#middle');
          return;
        }

        const detail      = event.detail;
        const heightDiff  = detail.height - detail.condensedHeight;
        const yRatio      = Math.min(1, detail.y / heightDiff);
        const scaleBottom = 1 - yRatio;
        // uncomment above lines and remove line below to revert back to original specs
        // Scale bottomContainer and bottom sub title to nothing and back
        // Polymer.Base.transform(`scale(${scaleBottom}) translateZ(0)`, middleContainer);
        app.transform(`scale(${scaleBottom}) translateZ(0)`, middleContainer);
        const fadeRatio  = (yRatio > 0) ? (yRatio * 3) : 0;
        const fadeMiddle = (fadeRatio < 1) ? fadeRatio : 1;
        middleContainer.style.opacity = 1 - fadeMiddle;
      };

      window.requestAnimationFrame(transformHeader);
    });
  };


  const createLink = (href, cb) => {
    const link = document.createElement('link');

    const linkLoaded = () => {
      link.removeEventListener('load', linkLoaded, false);
      if (cb && typeof cb === 'function') {
        cb();
      }
    };
    
    link.rel  = 'import';
    link.href = href;
    link.addEventListener('load', linkLoaded, false);
    link.setAttribute('async', '');
    document.head.appendChild(link);
  };


  const finishLazyLoading = script => {
    if (script) {
      script.removeEventListener('load', finishLazyLoading, false);
    }
    // Use native Shadow DOM if it's available in the browser.
    window.Polymer = window.Polymer || {dom: 'shadow', lazyRegister: true};

    createLink('elements/elements.html', setupPaperHeaderTransformListener);
  };

 
  // conditionally load web components polyfills
  const webComponentsSupported = ('registerElement' in document && 
                                  'import' in document.createElement('link') && 
                                  'content' in document.createElement('template'));

  if (webComponentsSupported) {
    finishLazyLoading();
  } else {
    const script  = document.createElement('script');
    script.async  = true;
    script.src    = 'bower_components/webcomponentsjs/webcomponents-lite.min.js';
    script.onload = finishLazyLoading(script);
    document.head.appendChild(script);
  }



  // &&&&&&&&&&&&&&& only needed for production if service worker is inop &&&&&&&&&&&&&&&&&&&&&&&&


  // // show a dialog anytime user chooses to leave or refresh site
  // // to avoid any accidental back button or refresh button taps
  // const confirmWindowCloseAction = event => {
  //   const text = 'Do you want to leave REDAAP?';
  //   event.returnValue = text;
  //   return text;
  // };

  // window.onbeforeunload = confirmWindowCloseAction;

})(document);
