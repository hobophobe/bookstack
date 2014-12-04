/* ***** BEGIN LICENSE BLOCK *****
 *   Version: GPL 2.0
 *
 * Bookstack extension: a queue implementation for bookmarks.
 * Copyright (C) 2007-2014  Adam Dane
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 *
 * Certain portions of the code are owned by The Mozilla Corporation.
 * These portions are relicensed as GPL 2.0 as per the option to do so stated
 * by the respective licenses of applicable projects.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

var NSGetFactory,
    cmdline,
    EXPORTED_SYMBOLS = ['cmdline'];

(function () {
  var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components,
      bookstackHandlerObj,
      bookstackHandlerModule,
      nsISupports = Ci.nsISupports,
      nsICommandLineHandler = Ci.nsICommandLineHandler,
      nsIFactory = Ci.nsIFactory,
      nsIModule = Ci.nsIModule,
      nsIComponentRegistrar = Ci.nsIComponentRegistrar,
      nsICategoryManager = Ci.nsICategoryManager;

  Cu.import("resource://gre/modules/XPCOMUtils.jsm");

  cmdline = {
    contractID:
      "@mozilla.org/commandlinehandler/general-startup;1?type=bookstack",
    classID: Components.ID("{dd84f400-e09b-46cd-980f-34d987f2d25c}"),
    classDescription: 'm-bookstack',
    category: 'command-line-handler',

    init: function (bookstack) {
      let registrar = Components.manager.QueryInterface(nsIComponentRegistrar);
      registrar.registerFactory(this.classID, this.classDescription,
                                this.contractID, this);
      let catMan = Cc["@mozilla.org/categorymanager;1"].
                   getService(nsICategoryManager);
      catMan.addCategoryEntry(this.category, this.classDescription,
                              this.contractID, false, true);
    },

    cleanUp: function () {
      let registrar = Components.manager.QueryInterface(nsIComponentRegistrar);
      let catMan = Cc["@mozilla.org/categorymanager;1"].
                   getService(nsICategoryManager);
      catMan.deleteCategoryEntry(this.category, this.classDescription, false);
      registrar.unregisterFactory(this.classID, this);
    },

    // nsIFactory interface implementation
    createInstance: function(outer, iid)
    {
      if (outer) {
        throw Cr.NS_ERROR_NO_AGGREGATION;
      }
      return this.QueryInterface(iid);
    },

    // nsISupports interface implementation
    QueryInterface: XPCOMUtils.generateQI([Ci.nsICommandLineHandler,
      Ci.nsIFactory]),
    /* nsICommandLineHandler */

    // Most of this file is boilerplate.  Here is the pertinent part.
    handle: function (aCommandLine) {
      var uristr, branch;
      if (aCommandLine.findFlag('bookstack-add', false) >= 0) {
        try {
          uristr = aCommandLine.handleFlagWithParam('bookstack-add', false);
          branch = Cc["@mozilla.org/preferences;1"].getService(
            Ci.nsIPrefService).getBranch('extensions.bookstack.');
          branch.setCharPref('commanduri', uristr);
          branch.setBoolPref('buttonupdate', true);
          aCommandLine.preventDefault = true;
        } catch (ex) {
          aCommandLine.handleFlag('bookstack-add', false);
          aCommandLine.preventDefault = true;
          Cu.reportError(
            "incorrect parameter passed to -bookstack-add via command line.");
        }
      }
    },

    // No longer used, but kept as a tribute to the elders of the command-line
    helpInfo: "  -bookstack-add <uri>     Push the URI on stack,\n",
  };
})();

