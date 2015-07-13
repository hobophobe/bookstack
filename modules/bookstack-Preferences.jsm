/* ***** BEGIN LICENSE BLOCK *****
 *   Version: GPL 2.0
 *
 * Bookstack extension: a queue implementation for bookmarks.
 * Copyright (C) 2008-2014 Adam Dane
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

"use strict";

var pref,
    EXPORTED_SYMBOLS = ['pref'];

(function () {
  var {interfaces: Ci, utils: Cu} = Components,
      bookstack;

  pref = {
    init: function(aBookstack) {
      bookstack = aBookstack;
    },
    // "Class" for preferences, including convenience functions.
    Preference: function (aName, aType, aValue) {
      this.prefName = aName;
      this.type = aType || bookstack.pref.lookupType(aName);

      if (aValue) {
        bookstack.pref.persistPref(this, aValue);
      }

      this.value = function () {
        return bookstack.pref.lookupPref(this.prefName, this.type);
      };
      this.persist = function (aValue) {
        bookstack.pref.persistPref(this, aValue);
      };
      this.remove = function () {
        bookstack.pref.removePref(this.prefName);
      };
    },

    // Gets the branch of preferences where bookstack preferences are stored.
    getBranch: function () {
      return bookstack.serv.getBranch('extensions.bookstack.');
    },

    // Wrapped inside of Preference above. Saves the value in the preference.
    persistPref: function (aPref, aValue) {
      var pBranch = this.getBranch();
      try {
        switch (aPref.type) {
        case 'string':
          pBranch.setCharPref(aPref.prefName, aValue);
          break;
        case 'integer':
          pBranch.setIntPref(aPref.prefName, aValue);
          break;
        case 'boolean':
          pBranch.setBoolPref(aPref.prefName, aValue);
          break;
        default:
        }
      } catch (ex) {}
    },

    // Removes a preference, wrapped above.
    removePref: function (aPref) {
      this.getBranch().clearUserPref(aPref);
    },

    // Helper to determine the type based on its name.
    lookupType: function (aName) {
      var pBranch = this.getBranch(),
          type;
      try {
        type = pBranch.getPrefType(aName);
      } catch (ex) {}
      return type;
    },

    // Helper to get the preference from its name.
    lookupPref: function (aName, aType) {
      var type = aType || this.lookupType(aName),
          pBranch;
      if (!type) {
        return null;
      }
      pBranch = this.getBranch();
      try {
        switch (type) {
        case 'string':
          return pBranch.getCharPref(aName);
        case 'integer':
          return pBranch.getIntPref(aName);
        case 'boolean':
          return pBranch.getBoolPref(aName);
        default:
        }
      } catch (ex) {}
      return null;
    },

    // Creates a preference listener that will invoke the given callback
    // function when it receives an event.
    PrefListener: function (aFunc) {
      var pBranch = bookstack.pref.getBranch();

      this.register = function () {
        pBranch.addObserver("", this, false);
      };

      this.unregister = function unregister () {
        if (pBranch) {
          pBranch.removeObserver("", this);
        }
      };

      this.observe = function (aSubject, aTopic, aData) {
        if (aTopic === 'nsPref:changed') {
          aFunc(pBranch, aData);
        }
      };
    },

    // Creates all of the preferences used by bookstack using the above class.
    loadPrefs: function () {
      if (this.initval) {
        return;
      }
      this.initval = 1;

      this.SIDE_LMB = new this.Preference('side_lmb', 'integer');
      this.SIDE_MMB = new this.Preference('side_mmb', 'integer');
      this.SIDE_RMB = new this.Preference('side_rmb', 'integer');

      this.STACK_FOLDER = new this.Preference('stack', 'integer');
      this.STACK_FOLDER_GUID = new this.Preference('stackGUID', 'string');
      this.STACK_FOCUS = new this.Preference('stack_focus', 'boolean');
      this.STACK_RITEMS = new this.Preference('stack_ritems', 'boolean');
      this.STACK_CEXIT = new this.Preference('stack_cexit', 'boolean');
      this.STACK_CCLR = new this.Preference('stack_cclr', 'boolean');
      this.STACK_CLOSEADD = new this.Preference('stack_closeadd', 'boolean');
      this.STACK_MIDCLICK = new this.Preference(
        'stack_middleclick', 'boolean');
      this.STACK_NOTIFY = new this.Preference('stack_notify', 'boolean');
      this.STACK_MODKEY = new this.Preference('stack_modifierkey', 'boolean');
      this.MENU_CONTENT = new this.Preference('menu.content', 'boolean');
      this.MENU_TOOLS = new this.Preference('menu.tools', 'boolean');
      this.MENU_CURRENT = new this.Preference('menu.current', 'boolean');
      this.MENU_RCURRENT = new this.Preference('menu.rcurrent', 'boolean');
      this.LAST_FOLDER = new this.Preference('last_folder', 'integer');
      this.STACK_FILTERS = new this.Preference('filters', 'integer');
      //These two are for command line handling
      this.STACK_CMDLINE_UPDATE = new this.Preference(
        'buttonupdate', 'boolean');
      this.STACK_CMDLINE_URI = new this.Preference('commanduri', 'string');
      this.VERSION = new this.Preference('version', 'string');
    }
  };
}());

// From https://developer.mozilla.org/en-US/Add-ons/How_to_convert_an_overlay_extension_to_restartless#Step_4.3A_Manually_handle_default_preferences

function getGenericPref(branch,prefName) {
  switch (branch.getPrefType(prefName)) {
    default:
    case 0:   return undefined;                      // PREF_INVALID
    case 32:  return getUCharPref(prefName,branch);  // PREF_STRING
    case 64:  return branch.getIntPref(prefName);    // PREF_INT
    case 128: return branch.getBoolPref(prefName);   // PREF_BOOL
  }
}

function setGenericPref(branch,prefName,prefValue) {
  switch (typeof prefValue) {
  case 'string':
    setUCharPref(prefName,prefValue,branch);
    break;
  case 'number':
    branch.setIntPref(prefName,prefValue);
    break;
  case 'boolean':
    branch.setBoolPref(prefName,prefValue);
    break;
  }
  return;
}

function setDefaultPref(prefName,prefValue) {
  var defaultBranch = Services.prefs.getDefaultBranch(null);
  setGenericPref(defaultBranch,prefName,prefValue);
}

function getUCharPref(prefName,branch) { // Unicode getCharPref
  branch = branch ? branch : Services.prefs;
  return branch.getComplexValue(prefName,
                                Components.interfaces.nsISupportsString).data;
}

function setUCharPref(prefName,text,branch) { // Unicode setCharPref
  var string = Components.classes["@mozilla.org/supports-string;1"]
                         .createInstance(
                           Components.interfaces.nsISupportsString);
  string.data = text;
  branch = branch ? branch : Services.prefs;
  branch.setComplexValue(prefName,
                         Components.interfaces.nsISupportsString, string);
}

var Services;
({Services} = Components.utils.import("resource://gre/modules/Services.jsm",
                                      null));
Services.scriptloader.loadSubScript(
  "resource://bookstack/content/defaultPrefs.js", { pref: setDefaultPref });

pref.loadPrefs();

