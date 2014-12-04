var bookstack = {};
var bookstackModuleURLs = [
  "resource://bookstack/modules/bookstack-Services.jsm",
  "resource://bookstack/modules/bookstack-Preferences.jsm",
  "resource://bookstack/modules/bookstack.jsm",
  "resource://bookstack/modules/bookstack-Drag.jsm",
  "resource://bookstack/modules/bookstack-cmdline.jsm"
];
const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
var OVERLAYS = {
  "chrome://global/content/customizeToolbar.xul": {
    styles: ["chrome://bookstack-os/skin/bookstack-button.css"]
  },
  "chrome://browser/content/browser.xul": {
    styles: ["chrome://bookstack-os/skin/bookstack-button.css"]
  }
}

function startup(aData, aReason) {
  try {
    let resource = Services.io.getProtocolHandler('resource').
                   QueryInterface(Ci.nsIResProtocolHandler);
    let alias = Services.io.newFileURI(aData.installPath);
    if (aData && !aData.installPath.isDirectory()) {
      alias = Services.io.newURI('jar:' + alias.spec + '!/', null, null);
    }
    resource.setSubstitution('bookstack', alias);

    bookstackModuleURLs.forEach((aModule) => {
      Cu.import(aModule, bookstack);
    });
    for (let module in bookstack) {
      if (bookstack[module].init) {
        bookstack[module].init(bookstack);
      }
    }
  } catch (e) {
    Cu.reportError(e);
  }
}

function shutdown(aData, aReason) {
  try {
    let resource = Services.io.getProtocolHandler('resource').
                   QueryInterface(Ci.nsIResProtocolHandler);
    for (let module in bookstack) {
      if (bookstack[module].cleanUp) {
        bookstack[module].cleanUp(aReason == APP_SHUTDOWN);
      }
    }
    bookstackModuleURLs.forEach(Cu.unload);
    resource.setSubstitution('bookstack', null);
  } catch (e) {
    Cu.reportError(e);
  }
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}

