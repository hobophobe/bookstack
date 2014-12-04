/* ***** BEGIN LICENSE BLOCK *****
 *   Version: GPL 2.0
 *
 * Bookstack extension: a queue implementation for bookmarks.
 * Copyright (C) 2010-2011 Adam Dane
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
 * These portions are relicensed as GPL 2.0 as per the option to do so stated by
 * the respective licenses of applicable projects.
 *
 * ***** END LICENSE BLOCK ***** */

// Based on some of the sample modules in the Mozilla Labs, this module is
// designed to make it easier to get to various services

"use strict";

var serv,
    EXPORTED_SYMBOLS = ['serv'];

(function () {
  var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components,
      bookstack;

  Cu.import("resource://gre/modules/Promise.jsm");
  Cu.import("resource://gre/modules/PlacesUtils.jsm");

  serv = {
    init: function(aBookstack) {
      bookstack = aBookstack;
    },

    // Bookmark Service
    BMSVC: function () {
      return Cc["@mozilla.org/browser/nav-bookmarks-service;1"].getService(
        Ci.nsINavBookmarksService);
    },

    // Livemark Service
    LMSVC: function () {
      return Cc["@mozilla.org/browser/livemark-service;2"].getService(
        Ci.mozIAsyncLivemarks);
    },

    // FIXME combine this with isLivemark?
    getLivemark: function (aBookmarkId, aCallback) {
      function trueCallback(aLivemark) {
        aCallback(true, aLivemark);
      }
      function falseCallback() {
        aCallback(false, null);
      }
      let promise = this.LMSVC().getLivemark({id: aBookmarkId});
      promise.then(trueCallback, falseCallback);
    },

    isLivemarkByNode: function(aNode) {
      return PlacesUtils.nodeIsFolder(aNode) &&
             PlacesUtils.annotations.itemHasAnnotation(aNode.itemId,
               PlacesUtils.LMANNO_FEEDURI);
    },

    // Helper to check if it's a livemark without pulling the LMSVC directly
    isLivemark: function (aBookmarkId, aCallback) {
      // Null ID, so do our best to be honest.
      if (!aBookmarkId && aCallback) {
        aCallback(false);
      }
      function trueCallback() {
        aCallback(true);
      }
      function falseCallback() {
        aCallback(false);
      }
      let promise = this.LMSVC().getLivemark({ id: aBookmarkId });
      promise.then(trueCallback, falseCallback);
    },

    // Addon Service
    AddonSVC: function () {
      try {
        Components.utils['import']("resource://gre/modules/AddonManager.jsm");
      }
      catch (exAddonManager) {
        return null;
      }
      return AddonManager;
    },

    // Helper to pull the addon data for this add-on
    bookstackAddon: function (aCallback) {
      var bookstackID = "{3dba5b22-2e1a-11dc-8314-0800200c9a66}";
      this.AddonSVC().getAddonByID(bookstackID, aCallback);
    },

    // Window Mediator Service
    wm: function () {
      return Cc["@mozilla.org/appshell/window-mediator;1"].getService(
        Ci.nsIWindowMediator);
    },

    // Helper to get the main window without pulling the WMSVC directly
    getWindow: function () {
      return this.wm().getMostRecentWindow('navigator:browser');
    },

    // Helper to get the browser without getting the window directly
    getBrowser: function () {
      return this.getWindow().getBrowser();
    },

    getTopWindow: function (aWindow) {
      return aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIWebNavigation)
                    .QueryInterface(Ci.nsIDocShellTreeItem)
                    .rootTreeItem
                    .QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIDOMWindow);
    },

    // Input/Output Service
    IOSVC: function () {
      return Cc["@mozilla.org/network/io-service;1"].getService(
        Ci.nsIIOService);
    },

    // Helper to convert a String to a URI
    getURI: function (aURLString) {
      return this.IOSVC().newURI(aURLString, null, null);
    },

    // Observer Service
    OSVC: function () {
      return Cc["@mozilla.org/observer-service;1"].getService(
        Ci.nsIObserverService);
    },

    // Helper to add an observer
    addObserver: function (aObserver, aEvent, aOwnsWeak) {
      return this.OSVC().addObserver(aObserver, aEvent, aOwnsWeak);
    },

    // Helper to remove an observer
    removeObserver: function (aObserver, aEvent) {
      return this.OSVC().removeObserver(aObserver, aEvent);
    },

    // Alerts Service (used for notifications in Bookstack < 0.6.5)
    ASVC: function () {
      return Cc["@mozilla.org/alerts-service;1"].getService(
        Ci.nsIAlertsService);
    },

    // Preferences Service
    PSVC: function () {
      return Cc["@mozilla.org/preferences-service;1"].
             getService(Ci.nsIPrefService);
    },

    getBoolPref: function (aPref) {
      let prefParts = aPref.split('.');
      let branchString = prefParts.slice(0, -1).join('.') + '.';
      let branch = this.getBranch(branchString);
      return branch.getBoolPref(prefParts.slice(-1));
    },

    // Helper to get a specific branch of the preferences
    getBranch: function (aBranchString) {
      return this.PSVC().getBranch(aBranchString);
    },

    WindowWatcher: function () {
      return Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(
        Ci.nsIWindowWatcher);
    }
  };
}());

