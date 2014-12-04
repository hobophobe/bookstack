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
 * ***** END LICENSE BLOCK ***** */

/*
 * The structure of the stack is a regular bookmark folder containing:
 * -Bookmarks
 * -Folders - can be stack, opening pulls contents into parent
 * -Separators - for display only
 * -Livemarks - Treated like folders for opening, but can't be a stack.
 */

"use strict";

var stack,
    EXPORTED_SYMBOLS = ['stack'];

(function () {
  var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components,
      BMSVC, bookstack,
      CustomizableUI, Services;

  ({Services}) = Cu.import("resource://gre/modules/Services.jsm", null);
  ({CustomizableUI}) = Cu.import("resource:///modules/CustomizableUI.jsm",
                                 null);

  if (typeof PlacesUtils === 'undefined') {
    try {
      Cu['import']("resource://gre/modules/PlacesUtils.jsm");
    } catch (exPlacesUtils) {}
  }

  stack = {
    // that gets created per window and shutdown per window?
    init: function(aBookstack) {
      bookstack = aBookstack;
      bookstack.serv.bookstackAddon(this.versionHandler);
      BMSVC = bookstack.serv.BMSVC();
      this.forEachOpenWindow(this.WindowListener.setupUI);
      Services.wm.addListener(this.WindowListener);
      this.addPrefListener();
    },

    cleanUp: function(aIsShutdown) {
      // Should happen early to have strings (for confirmation text)
      if (aIsShutdown && bookstack.pref.STACK_CEXIT.value()) {
        this.onClrStack(true);
      }
      this.forEachOpenWindow(this.WindowListener.removeUI);
      Services.wm.removeListener(this.WindowListener);
      this.prefListenerSet.unregister();
      this.prefListenerSet = null;
    },

    // startup and shutdown related stuff

    // Updates the version number.
    versionHandler: function (aAddon) {
      var version = aAddon.version,
          stackVersion = bookstack.pref.VERSION.value();
      if (!stackVersion || stackVersion !== version) {
        bookstack.pref.VERSION.persist(version);
      }
    },

    addPrefListener: function() {
      let self = bookstack.stack;
      self.prefListenerSet = new bookstack.pref.PrefListener(
        function (aBranch, aName) {
          switch (aName) {
            case 'stack_middleclick':
              self.toggleMiddleClickListener();
              break;
            case 'buttonupdate':
              self.fromCommandLine();
              break;
          }
        });
      self.prefListenerSet.register();
      if (bookstack.pref.STACK_CMDLINE_URI.value()) {
        self.fromCommandLine();
      }
    },

    addKeySet: function(aDoc, aKS, aInfoArray) {
      let modKeyString = this.getString('modkey')
      for (let info of aInfoArray) {
        let key = aDoc.createElement('key');
        key.id = info['id'];
        key.setAttribute('modifiers', modKeyString);
        key.setAttribute('key', this.getString(info['key']));
        if (info.hasOwnProperty('command')) {
          key.setAttribute('command', info['command']);
        } else if (info.hasOwnProperty('action')) {
          key.setAttribute('oncommand', info['action']);
        }
        aKS.appendChild(key);
      }
    },

    removeKeySet: function(aKS, aIDArray) {
      for (let id of aIDArray) {
        let node = aKS.querySelector('#' + id);
        if (node) {
          aKS.removeChild(node);
        }
      }
    },

    addNoteBox: function(aDoc) {
      let parent = aDoc.getElementById('notification-popup-box');
      let item = aDoc.createElement('image');
      item.id = 'bookstack-notification-icon';
      item.classList.add('notification-anchor-icon');
      item.setAttribute('role', 'button');
      parent.appendChild(item);
    },

    removeNoteBox: function(aDoc) {
      let parent = aDoc.getElementById('notification-popup-box');
      let item = parent.querySelector('#bookstack-notification-icon');
      parent.removeChild(item);
    },

    addMenuItemSet: function(aDoc, aMenu, aInfoArray) {
      for (let info of aInfoArray) {
        let mi = aDoc.createElement('menuitem');
        mi.id = info['id'];
        mi.setAttribute('label', this.getString(info['label']));
        if (info.hasOwnProperty('accesskey')) {
          mi.setAttribute('accesskey', this.getString(info['accesskey']));
        }
        if (info.hasOwnProperty('key')) {
          mi.setAttribute('key', info['key']);
        }
        if (info.hasOwnProperty('command')) {
          mi.setAttribute('oncommand', info['command']);
        } else if (info.hasOwnProperty('observes')) {
          mi.setAttribute('observes', info['observes']);
        }
        if (info.hasOwnProperty('insertafter')) {
          let next = aMenu.querySelector('#' + info['insertafter']);
          if (next) {
            next = next.nextSibling;
          }
          aMenu.insertBefore(mi, next);
        } else {
          aMenu.appendChild(mi);
        }
      }
    },

    removeMenuItemSet: function(aMenu, aIDArray) {
      for (let id of aIDArray) {
        let node = aMenu.querySelector('#' + id);
        if (node) {
          aMenu.removeChild(node);
        }
      }
    },

    // TODO add accesskeys to these
    addTabMenuItems: function(aDoc) {
      let menu = aDoc.getElementById('tabContextMenu');
      menu.addEventListener('popupshowing', this.toggleStackItems, false);
      this.addMenuItemSet(aDoc, menu, [{
        id: 'bookstack-tabpush',
        label: 'pushthis',
        command: 'bookstack.stack.pushThisTab(event);'
      },
      {
        id: 'bookstack-taball',
        label: 'pushall',
        command: 'bookstack.stack.pushAllTabs(event);'
      }]);
    },

    removeTabMenuItems: function(aDoc) {
      let menu = aDoc.getElementById('tabContextMenu');
      menu.removeEventListener('popupshowing', this.toggleStackItems, false);
      this.removeMenuItemSet(menu, ['bookstack-tabpush', 'bookstack-taball']);
    },

    addContextMenuItems: function (aDoc) {
      let menu = aDoc.getElementById('contentAreaContextMenu');

      menu.addEventListener('popupshowing',
                            this.bookstackContext, false);

      this.addMenuItemSet(aDoc, menu, [{
        id: 'context-bookstack-add',
        label: 'addlink',
        accesskey: 'addlinkAK',
        command: 'bookstack.stack.menuAddToStack(event);',
        insertafter: 'context-sep-copylink'
      },
      {
        id: 'context-bookstack-rcurrent',
        label: 'rcurrent',
        accesskey: 'rcurrentAK',
        command: 'bookstack.stack.remCurrentFromStack(event);',
        insertafter: 'context-savepage'
      },
      {
        id: 'context-bookstack-current',
        label: 'current',
        accesskey: 'currentAK',
        command: 'bookstack.stack.addCurrentToStack(event);',
        insertafter: 'context-savepage'
      }]);
    },

    removeContextMenuItems: function (aDoc) {
      let menu = aDoc.getElementById('contentAreaContextMenu');
      menu.removeEventListener('popupshowing',
                               this.bookstackContext, false);
      this.removeMenuItemSet(menu, ['context-bookstack-add',
                                    'context-bookstack-rcurrent',
                                    'context-bookstack-current']);
    },

    addToolMenuItems: function(aDoc) {
      let menu = aDoc.getElementById('menu_ToolsPopup');

      menu.addEventListener('popupshowing',
                            this.bookstackTools, false);

      this.addMenuItemSet(aDoc, menu, [{
        id: 'bookstack-tool',
        label: 'bookstack-title',
        accesskey: 'bookstack-AK',
        observes: 'viewBookstackSidebar',
        insertafter: 'devToolsSeparator',
        key: 'bookstack-side-key'
      }]);
    },

    removeToolMenuItems: function(aDoc) {
      let menu = aDoc.getElementById('menu_ToolsPopup');
      menu.removeEventListener('popupshowing',
                               this.bookstackTools, false);
      this.removeMenuItemSet(menu, ['bookstack-tool']);
    },

    addSidebarMenuItems: function(aDoc) {
      let menu = aDoc.getElementById('viewSidebarMenu');

      this.addMenuItemSet(aDoc, menu, [{
        id: 'bookstack-sidebar-menu',
        label: 'bookstack-title',
        accesskey: 'bookstack-AK',
        observes: 'viewBookstackSidebar',
        key: 'bookstack-side-key'
      }]);
    },

    removeSidebarMenuItems: function(aDoc) {
      let menu = aDoc.getElementById('viewSidebarMenu');
      this.removeMenuItemSet(menu, ['bookstack-sidebar-menu']);
    },

    forEachOpenWindow: function(aTodo) {
      let windows = Services.wm.getEnumerator('navigator:browser');
      while (windows.hasMoreElements()) {
        let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
        aTodo(domWindow);
      }
    },

    WindowListener: {
      setupUI: function(aWin) {
        let doc = aWin.document;
        let winType = doc.documentElement.getAttribute('windowtype');
        if (winType != 'navigator:browser') {
          return;
        }
        aWin.bookstack = bookstack;
        let stack = bookstack.stack;
        stack.setStringBundle();
        stack.addStylesForWindow(aWin);
        stack.addToolbarButton(doc);
        stack.addNoteBox(doc);
        stack.toggleMiddleClickListenerForWindow(aWin);
        stack.addTabMenuItems(doc);
        stack.addContextMenuItems(doc);
        stack.addToolMenuItems(doc);
        stack.registerBMO(stack.notificationBMObserver);
        stack.watchBookmarks();
      },

      removeUI: function(aWin) {
        let doc = aWin.document;
        let winType = doc.documentElement.getAttribute('windowtype');
        if (winType != 'navigator:browser') {
          return;
        }
        let stack = bookstack.stack;
        Services.strings.flushBundles();
        stack.bundle = null;
        delete stack.bundle;
        stack.removeStylesForWindow(aWin);
        stack.removeToolbarButton(doc);
        stack.removeNoteBox(doc);
        stack.toggleMiddleClickListenerForWindow(aWin, true);
        stack.removeTabMenuItems(doc);
        stack.removeContextMenuItems(doc);
        stack.removeToolMenuItems(doc);
        stack.unregisterBMO(stack.notificationBMObserver);
        stack.unwatchBookmarks();
        aWin.bookstack = null;
        delete aWin.bookstack;
      },

      onOpenWindow: function(aWin) {
        let domWindow = aWin.QueryInterface(Ci.nsIInterfaceRequestor).
                        getInterface(Ci.nsIDOMWindow);
        domWindow.addEventListener('load', function listen() {
          domWindow.removeEventListener('load', listen, false);
          let doc = domWindow.document.documentElement;
          let winType = doc.getAttribute('windowtype');
          if (winType == 'navigator:browser') {
            bookstack.stack.WindowListener.setupUI(domWindow);
          }
        }, false);
      },

      onCloseWindow: function(aWin) {},
      onWindowTitleChange: function(aWin, aTitle) {},
    },

    setupSidebar: function(aDoc) {
      let keyset = aDoc.getElementById('mainKeyset'),
          bcset = aDoc.getElementById('mainBroadcasterSet'),
          menupopup = aDoc.getElementById('viewSidebarMenu');
      if (keyset && !keyset.querySelector('#bookstack-side-key')) {
        this.addKeySet(aDoc, keyset, [{
          id: 'bookstack-side-key',
          key: 'sidekey',
          command: 'viewBookstackSidebar'
        },
        {
          id: 'bookstack-pop-key',
          key: 'popkey',
          action: 'bookstack.stack.popFirst(event);'
        },
        {
          id: 'bookstack-add-key',
          key: 'addkey',
          action: 'bookstack.stack.addCurrentToStack(event);'
        }]);
        // Sometimes the keyboard shortcut doesn't work.
        // Reload the keyset to activate the key. (A workaround from Bug 832984)
        keyset.parentElement.appendChild(keyset);
      }

      // broadcaster
      if (bcset && !bcset.querySelector('#viewBookstackSidebar')) {
        let bc = aDoc.createElement('broadcaster');
        bc.setAttribute('id', 'viewBookstackSidebar');
        bc.setAttribute('label', this.getString('bookstack-title'));
        bc.setAttribute('autoCheck', 'false');
        bc.setAttribute('type', 'checkbox');
        bc.setAttribute('group', 'sidebar');
        bc.setAttribute('sidebarurl',
                        "chrome://bookstack/content/bookstack-Sidebar.xul");
        bc.setAttribute('sidebartitle', this.getString('bookstack-title'));
        bc.setAttribute('oncommand', "toggleSidebar('viewBookstackSidebar');");
        bcset.appendChild(bc);
      }

      // menuitem
      this.addSidebarMenuItems(aDoc);
    },

    defuseSidebar: function (aDoc) {
      // Ensure sidebar is closed
      let sidebar = aDoc.getElementById('sidebar-box');
      if (!sidebar.hidden &&
          sidebar.getAttribute('sidebarcommand') == 'viewBookstackSidebar') {
        aDoc.defaultView.toggleSidebar();
      }
      let keyset = aDoc.getElementById('mainKeyset'),
          bcset = aDoc.getElementById('mainBroadcasterSet'),
          menupopup = aDoc.getElementById('viewSidebarMenu');
      if (keyset) {
        this.removeKeySet(keyset, ['bookstack-side-key',
                                   'bookstack-pop-key',
                                   'bookstack-add-key']);

        // Sometimes the keyboard shortcut doesn't work.
        // Reload the keyset to activate the key. (A workaround from Bug 832984)
        keyset.parentElement.appendChild(keyset);
      }

      // broadcaster
      if (bcset) {
        let bc = bcset.querySelector('#viewBookstackSidebar');
        if (bc) {
          bcset.removeChild(bc);
        }
      }

      // menuitem
      this.removeSidebarMenuItems(aDoc);
    },

    windowStyles: [
      "chrome://bookstack-os/skin/bookstack-button.css",
      "chrome://bookstack/skin/bookstack-notification.css"
    ],

    handleStylesForWindow: function (aWin, aAction) {
      if (aWin instanceof Ci.nsIInterfaceRequestor) {
        let winUtils = aWin.getInterface(Ci.nsIDOMWindowUtils);
        for (let i of this.windowStyles) {
          let uri = Services.io.newURI(i, null, null);
          winUtils[aAction](uri, Ci.nsIDOMWindowUtils.AUTHOR_SHEET);
        }
      }
    },

    addStylesForWindow: function (aWin) {
      this.handleStylesForWindow(aWin, 'loadSheet');
    },

    removeStylesForWindow: function (aWin) {
      this.handleStylesForWindow(aWin, 'removeSheet');
    },

    haveWidget: false,

    widgetListener: {
      onWidgetAfterDOMChange: function (aNode, aNextNode, aContainer,
                                        aWasRemoval) {
        if (aWasRemoval &&
            aNode.getAttribute('widget-id') == 'bookstack-side-button') {
          aNode.removeEventListener('dragover',
                                    bookstack.stack.dragObserver.onDragOver,
                                    false);
          aNode.removeEventListener('drop',
                                    bookstack.stack.dragObserver.onDrop,
                                    false);
        }
      }
    },

    addToolbarButton: function (aDoc) {
      let title = this.getString('bookstack-title');
      this.setupSidebar(aDoc);
      if (!this.haveWidget) {
        let widget = CustomizableUI.createWidget({
          id: 'bookstack-side-button',
          type: 'button',
          label: title,
          tooltiptext: title,
          removable: true,
          // This should mean it is automatically added on first-run,
          // and if the user opts to move it from this area,
          // it won't get readded.
          defaultArea: CustomizableUI.AREA_NAVBAR,
          onClick: function(aEvent) {
            if (aEvent.button != 0) {
              return;
            }
            let win = bookstack.serv.getWindow();
            win.document.defaultView.toggleSidebar('viewBookstackSidebar');
          },
          onCreated: function(aNode) {
            aNode.addEventListener('dragover',
                                   bookstack.stack.dragObserver.onDragOver,
                                   false);
            aNode.addEventListener('drop',
                                   bookstack.stack.dragObserver.onDrop,
                                   false);
          }
        });
        this.haveWidget = true;
        CustomizableUI.addListener(bookstack.stack.widgetListener);
      }
    },

    removeToolbarButton: function (aDoc) {
      this.haveWidget = false;
      CustomizableUI.removeListener(this.widgetListener);
      CustomizableUI.destroyWidget('bookstack-side-button');
      this.defuseSidebar(aDoc);
    },

    // Togglers

    // Changes whether middle clicks on links are listened.
    toggleMiddleClickListenerForWindow: function (aWin, aForceRemove) {
      let turnOn = bookstack.pref.STACK_MIDCLICK.value();
      var action = aWin.removeEventListener;
      if (turnOn && !aForceRemove) {
        action = aWin.addEventListener;
      }
      action('click', bookstack.stack.usurpMiddleClick, true);
    },

    // Changes whether middle clicks on links are listened.
    toggleMiddleClickListener: function (aShutdown) {
      let turnOn = bookstack.pref.STACK_MIDCLICK.value() && !aShutdown;
      bookstack.stack.forEachOpenWindow(function(aWin) {
        var action = aWin.removeEventListener;
        if (turnOn) {
          action = aWin.addEventListener;
        }
        action('click', bookstack.stack.usurpMiddleClick, true);
      });
    },


    // Determines visibility of tab context menu items based on count/context.
    toggleStackItems: function (aEvent) {
      var browser = bookstack.serv.getBrowser(),
          tabPanels = browser.browsers,
          goodFirst = false,
          goodTabs = false,
          doc = aEvent.target.ownerDocument,
          tab = browser.mContextTab,
          urlScheme = tab.linkedBrowser.webNavigation.currentURI.scheme;
      // True if more than two non-'about', non-pinned tabs are open
      goodTabs = tabPanels.some(function(aTab) {
        if (aTab.webNavigation.currentURI.scheme !== 'about' && !aTab.pinned) {
          if (goodFirst) {
            return true;
          }
          goodFirst = true;
        }
        return false;
      });
      doc.getElementById('bookstack-tabpush').setAttribute(
        'disabled', urlScheme === 'about' || tab.pinned);
      doc.getElementById('bookstack-taball').setAttribute(
        'disabled', !goodTabs);
    },

    // Switch remove on view to the opposite of its current setting.
    toggleRItems: function () {
      bookstack.pref.STACK_RITEMS.persist(!bookstack.pref.STACK_RITEMS.value());
    },

    // Switch clear on exit to the opposite of its current setting.
    toggleCExit: function () {
      bookstack.pref.STACK_CEXIT.persist(!bookstack.pref.STACK_CEXIT.value());
    },

    // Switch middle-click on links adds to stack to the opposite of its
    // current setting.
    toggleMiddl: function () {
      bookstack.pref.STACK_MIDCLICK.persist(
        !bookstack.pref.STACK_MIDCLICK.value());
    },

    // Called by listener, to add links via clicks.
    // FIXME in non-shim compatibility mode this handler will fail under e10s
    usurpMiddleClick: function (aEvent) {
      var target = aEvent.target,
          win = bookstack.serv.getTopWindow(target.ownerDocument.defaultView),
          linkNode,
          isModified = aEvent.ctrlKey || aEvent.metaKey,
          parent,
          text,
          newBookmark;
      if (aEvent.button !== 1 || !bookstack.pref.STACK_MIDCLICK.value() ||
         (!isModified && bookstack.pref.STACK_MODKEY.value())) {
        return false;
      }
      if (bookstack.stack.isALink(target)) {
        if (target.hasAttribute('href')) {
          linkNode = target;
        }
        parent = target.parentNode;
        while (parent) {
          if (bookstack.stack.isALink(parent) &&
              parent.hasAttribute('href')) {
            linkNode = parent;
          }
          parent = parent.parentNode;
        }
      } else {
        linkNode = aEvent.originalTarget;
        while (linkNode && !(linkNode instanceof win.HTMLAnchorElement)) {
          linkNode = linkNode.parentNode;
        }
      }
      // <a> cannot be nested.  So if we find an anchor without an
      // href, there is no useful <a> around the target
      if (linkNode && linkNode.hasAttribute('href')) {
        text = win.gatherTextUnder(linkNode);
        if (!text || !text.match(/\S/)) {
          text = linkNode.getAttribute('title');
        }
        if (!text || !text.match(/\S/)) {
          text = linkNode.getAttribute('alt');
        }
        if (!text || !text.match(/\S/)) {
          text = linkNode.linkURL;
        }
        newBookmark = bookstack.stack.onAddToStackIndex({
          url: linkNode.href,
          title: text,
          edit: aEvent.shiftKey
        });
        aEvent.preventDefault();
        aEvent.stopPropagation();
        if (newBookmark) {
          return true;
        }
      }
      return false;
    },

    // Visibility of context menu items based on preferences.
    bookstackContext: function (aEvent) {
      let win = bookstack.serv.getWindow(),
          doc = aEvent.target.ownerDocument,
          // FIXME this fails under e10s sometimes?
          gContextMenu = win.gContextMenu,
          onLink = gContextMenu.onLink,
          onTextInput = gContextMenu.onTextInput,
          addMenu = doc.getElementById('context-bookstack-add'),
          curMenu = doc.getElementById('context-bookstack-current'),
          remMenu = doc.getElementById('context-bookstack-rcurrent'),
          currentInStack = bookstack.stack.currentIsBookmarked();
      addMenu.hidden = !onLink ||
                       !bookstack.pref.MENU_CONTENT.value();
      curMenu.hidden = onLink || onTextInput ||
                       !bookstack.pref.MENU_CURRENT.value() ||
                       currentInStack;
      remMenu.hidden = onLink || onTextInput ||
                       !bookstack.pref.MENU_RCURRENT.value() ||
                       !currentInStack;
    },

    // Visibility of settings menu item on the tools menu based on preference.
    bookstackTools: function (aEvent) {
      aEvent.target.ownerDocument.getElementById('bookstack-tool').hidden =
        !bookstack.pref.MENU_TOOLS.value();
    },

    // Bookmark handling and helpers

    // Handle the command line via some temporary-use preferences.
    fromCommandLine: function () {
      if (bookstack.pref.STACK_CMDLINE_UPDATE.value()) {
        var url = bookstack.pref.STACK_CMDLINE_URI.value();
        //FIXME test it's a valid URI *or* catch if b.oATSI throws?
        if (url) {
          this.onAddToStackIndex({
            url: url,
            edit: false
          });
        }
        bookstack.pref.STACK_CMDLINE_UPDATE.persist(false);
      }
    },

    // Tests node for being appropriate target (Anchor, Area, Link)
    isALink: function (aNode) {
      let win = bookstack.serv.getTopWindow(aNode.ownerGlobal);
      return (aNode instanceof win.HTMLAnchorElement ||
              aNode instanceof win.HTMLAreaElement ||
              aNode instanceof win.HTMLLinkElement);
    },

    // Tab context menu: Add the current tab to stack.
    pushThisTab: function (aEvent) {
      var browser = bookstack.serv.getBrowser(),
          tab = browser.mContextTab,
          docShell,
          url,
          URI,
          title,
          newBookmark;
      if (tab.localName !== 'tab') {
        tab = browser.mCurrentTab;
      }
      URI = tab.linkedBrowser.webNavigation.currentURI;
      url = URI.spec;
      try {
        title = tab.label || url;
      } catch (ex) {
        title = url;
      }
      newBookmark = bookstack.stack.onAddToStackIndex({
        uri: URI,
        title: title,
        edit: aEvent.shiftKey
      });
      return newBookmark;
    },

    // Add all visible tabs to stack.
    pushAllTabs: function (aEvent) {
      if (aEvent.shiftKey) {
        bookstack.stack.pushAllTabsAsFolder();
      } else {
        bookstack.stack.pushAllTabsIntoStack();
      }
    },

    pushAllTabsIntoStack: function () {
      var browser = bookstack.serv.getBrowser(),
          tabPanels = browser.visibleTabs,
          closure,
          doBatch;
      closure = {
        tabPanels: tabPanels
      };
      closure.wrappedJSObject = closure;
      // The wrappedJSObject wisdom was taught by Mook on #extdev
      doBatch = {
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject,
              tabs = closed.tabPanels,
              tabBrowser,
              url,
              title,
              URI,
              shelf = bookstack.stack.getShelf();
          for (let tab of tabs) {
            tabBrowser = browser.getBrowserForTab(tab);
            URI = tabBrowser.webNavigation.currentURI;
            url = URI.spec;
            /* Skip chrome urls and pinned tabs */
            if (URI.scheme !== 'about' && !tab.pinned) {
              try {
                title = tab.label || url;
              } catch (ex) {
                title = url;
              }
              BMSVC.insertBookmark(shelf, URI, BMSVC.DEFAULT_INDEX, title);
            }
          }
        }
      };
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
    },

    // Add all visible tabs to stack in a new folder.
    pushAllTabsAsFolder: function () {
      let win = bookstack.serv.getWindow();
      let pages = win.PlacesCommandHook.uniqueCurrentPages;
      // Filter about scheme; uniqueCurrentPages handles pinned for us
      pages = pages.filter(aURI => aURI.scheme !== 'about');
      if (pages.length > 1) {
        let shelf = this.getShelf();
        let insertionPoint = new win.InsertionPoint(shelf, BMSVC.DEFAULT_INDEX,
                                                     0, false, false);
        win.PlacesUIUtils.showBookmarkDialog({
          action: 'add',
          type: 'folder',
          URIList: pages,
          hiddenRows: ['folderPicker', 'description'],
          defaultInsertionPoint: insertionPoint
        }, win);
      }
    },

    // Content area context item's associated function to add link to stack.
    menuAddToStack: function (aEvent) {
      let gContextMenu = bookstack.serv.getWindow().gContextMenu;
      return bookstack.stack.onAddToStackIndex({
        url: gContextMenu.linkURL,
        title: gContextMenu.linkText(),
        edit: !aEvent ? false : aEvent.shiftKey
      });
    },

    // Content area context: add this page to stack
    addCurrentToStack: function (aEvent) {
      var ctrl = !aEvent ? false : aEvent.ctrlKey,
          closePref = bookstack.pref.STACK_CLOSEADD.value(),
          // Equivalent to XOR
          wantToClose = ((closePref || ctrl) && !(closePref && ctrl)),
          browser = bookstack.serv.getBrowser(),
          tab = browser.mCurrentTab,
          // Manually check the number of tabs; don't close last tab.
          canClose = (browser.browsers.length > 1),
          newBookmark = bookstack.stack.onAddToStackIndex({
            uri: tab.linkedBrowser.webNavigation.currentURI,
            title: tab.label,
            edit: !aEvent ? false : aEvent.shiftKey
          });
      if (newBookmark) {
        if (wantToClose && canClose) {
          browser.removeCurrentTab();
        }
        return true;
      }
      return false;
    },

    // Content area context menu: remove this page from stack
    remCurrentFromStack: function (aEvent) {
      // get the URL we want to drop
      var shelf = bookstack.stack.getShelf(),
          currentTab = bookstack.serv.getBrowser().mCurrentTab,
          currentURL = currentTab.linkedBrowser.webNavigation.currentURI,
          itemSet = [],
          doBatch,
          closure;
      if (!BMSVC.isBookmarked(currentURL)) {
        return;
      }
      // set up our query
      BMSVC.getBookmarkIdsForURI(currentURL, {}).forEach(function(aBookmark) {
        if (BMSVC.getFolderIdForItem(aBookmark) === shelf) {
          itemSet.push(aBookmark);
        }
      });
      doBatch = {
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject;
          closed.items.forEach(BMSVC.removeItem);
        }
      };
      closure = { items: itemSet };
      closure.wrappedJSObject = closure;
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
    },

    // Boolean: Whether the displayed page is bookmarked in the stack.
    currentIsBookmarked: function () {
      var currentTab = bookstack.serv.getBrowser().mCurrentTab,
          currentURL = currentTab.linkedBrowser.webNavigation.currentURI;
      if (!BMSVC.isBookmarked(currentURL)) {
        return false;
      }
      return BMSVC.getBookmarkIdsForURI(currentURL, {}).some(
        aId => BMSVC.getFolderIdForItem(aId) === bookstack.stack.getShelf());
    },

    bundle: null,
    BUNDLE_URL: "chrome://bookstack/locale/bookstack.properties",
    setStringBundle: function() {
      if (!this.bundle) {
        // Fixes e10s not reloading...
        this.bundle = Services.strings.createBundle(
          this.BUNDLE_URL + '?' + Math.random());
      }
    },

    getStringBundle: function() {
      return this.bundle;
    },

    getString: function(aName) {
      try {
        let bundle = this.getStringBundle();
        let str = bundle.GetStringFromName(aName);
        return str;
      } catch (e) {
        // AFAICT this is a bug with e10s
        // If we reinstall the add-on it doesn't resolve the bundle file
        // See setStringBundle fix above.
        return 'UNKNOWN_STRING';
      }
    },

    doesFolderExist: function(aFolderId) {
      var title;
      try {
        aFolderId = parseInt(aFolderId, 10);
      } catch (exDoesFolderExistParseInt) {
        return false;
      }
      try {
        title = BMSVC.getItemTitle(aFolderId);
        if (typeof title !== 'undefined') {
          return true;
        }
      } catch (exDoesFolderExistGetTitle) {}
      return false;
    },

    // Generic mechanism for creating either a folder in batch mode
    setupFolderInBatch: function (aParent, aFolderName, aIndex) {
      var closure = {
            parent: aParent,
            folderName: aFolderName,
            index: aIndex,
            id: null
          },
          doBatch;
      closure.wrappedJSObject = closure;
      doBatch = {
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject;
          closed.id = BMSVC.createFolder(
            closed.parent, closed.folderName, closed.index);
        }
      };
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
      return closure.wrappedJSObject.id;
    },

    // maintenance of stack
    setupStackFolder: function () {
      var id;
      this.unwatchBookmarks();
      try {
        id = this.setupFolderInBatch(BMSVC.bookmarksMenuFolder,
                                     this.getString('stackname'),
                                     BMSVC.DEFAULT_INDEX);
      } catch (ex) {}
      this.watchBookmarks();
      bookstack.pref.STACK_FOLDER.persist(id);
      return id;
    },

    // Simple getter for the current stack folder, creates if doesn't exist.
    getShelf: function () {
      var stack = bookstack.pref.STACK_FOLDER.value();
      if (!stack || !this.doesFolderExist(stack)) {
        return this.setupStackFolder();
      }
      return stack;
    },

    // Minimal DND handler for the sidebar button.
    dragObserver: {
      onDragOver: function (aEvent) {
        if (bookstack.dnd.canDrop(aEvent, aEvent.target.id)) {
          return aEvent.preventDefault();
        }
        return false;
      },
      onDrop: function (aEvent) {
        bookstack.dnd.onDrop(
          aEvent, BMSVC.DEFAULT_INDEX, bookstack.stack.getShelf());
      }
    },

    // Keeps resetting of folders from causing excessive recursion:
    //  We keep track of all of the extension's BMOs here.
    //  We enable or disable them in a group (though facilities remain
    //  for individual changes too).
    BMObservers: [],
    BMObserversDisabled: false,
    BMObserverWatchState: 0,

    registerBMO: function (aBMO) {
      var observers = this.BMObservers,
          observer = observers.indexOf(aBMO);
      if (observer === -1) { /* Ensure it's not there already */
        this.enableObserver(aBMO);
        observers.push(aBMO);
        return aBMO;
      }
      return null;
    },

    unregisterBMO: function (aBMO) {
      var observers = this.BMObservers,
          observer = observers.indexOf(aBMO);
      if (observer > -1) {
        this.disableObserver(observers[observer]);
        return observers.splice(observer, 1);
      }
      return null;
    },

    disableObserver: function (aObserver) {
      if (!this.BMObserversDisabled) {
        try {
          BMSVC.removeObserver(aObserver);
        } catch (ex) {}
      }
    },

    enableObserver: function (aObserver) {
      if (!this.BMObserversDisabled) {
        try {
          BMSVC.addObserver(aObserver, false);
        } catch (ex) {}
      }
    },

    // We track the number of observers that have enabled/disabled watching
    watchBookmarks: function () {
      this.BMObserverWatchState -= 1;
      if (this.BMObserverWatchState === 0) {
        var observers = this.BMObservers;
        this.BMObserversDisabled = false;
        observers.forEach(this.enableObserver, this);
      }
    },

    // We track the number of observers that have enabled/disabled watching
    unwatchBookmarks: function () {
      if (this.BMObserverWatchState === 0) {
        var observers = this.BMObservers;
        this.BMObserversDisabled = false;
        observers.forEach(this.disableObserver, this);
        this.BMObserversDisabled = true;
      }
      this.BMObserverWatchState += 1;
    },

    // Instead of trying to call for a note everywhere a change is made, this
    // allows us to sit back, maybe watch a little Mork and Mindy on channel 57.
    notificationBMObserver: {
      onBeginUpdateBatch: function () {},
      onEndUpdateBatch: function () {},
      onItemChanged: function (aId, aProp, aB_AnnoP, aValue, aMod, aType,
                               aParentId, aGUID, aParentGUID) {},
      onItemVisited: function (aId, aVisitId, aTime, aTransitionType, aURI,
                               aParentId, aGUID, aParentGUID) {},

      onItemAdded: function (aId, aParentId, aIndex, aType, aURI, aTitle, aDate,
                             aGUID, aParentGUID) {
        if (aParentId === bookstack.stack.getShelf()) {
          bookstack.stack.itemAddedNotification(aId, aURI, aTitle);
        }
      },

      onItemRemoved: function (aId, aParentId, aIndex, aType, aURI, aGUID,
                               aParentGUID) {
        var NSVC = bookstack.stack.noteService,
            matched = -1;
        NSVC.notifications.some(function(aNoteSet, aIndex) {
          if (!aNoteSet.length) {
            return false;
          }
          var noteId = parseInt(aNoteSet[0].note.id.split('-')[2], 10);
          if (aId === noteId) {
            matched = aIndex;
            return true;
          }
          return false;
        });
        if (matched > -1) {
          NSVC.removeNote({ value: matched });
        }
      },

      onItemMoved: function (aId, aOldParentId, aOldIdx, aNewPId, aNewIdx,
                             aType, aGUID, aOldParentGUID, aNewParentGUID) {
        var shelf = bookstack.stack.getShelf();
        if (aNewPId === shelf && aOldParentId !== shelf) {
          bookstack.stack.itemAddedNotification(
            aId, BMSVC.getBookmarkURI(aId), BMSVC.getItemTitle(aId));
        }
      }
    },

    // Uses the doorhang-type notifications (Fx4+)
    noteService: {
      // A list of the unshown, new bookmarks.
      notifications: [],
      notificationTimeout: null,
      NOTE_ICON: "chrome://bookstack-img/skin/bookstack-icon.png",

      // Adds a note and makes sure the alerts have been kicked off.
      ping: function (aNote) {
        var NSVC = this,
            notes = NSVC.notifications;
        NSVC.popupNotification(aNote);
        notes.push(aNote);
//        NSVC.update();
      },

      // Observes for when we're ready to show another note (if there is one).
      handler: function () {
        var that = this;
        function observer(subj, topic, id) {
          var NSVC = that,
              notes = NSVC.notifications,
              browser,
              note;
          if (topic === 'alertclickcallback') {
            NSVC.hasNote = false;
            browser = bookstack.serv.getWindow();
            // The user may be trying to edit a defunct item.
            try {
              BMSVC.getItemTitle(parseInt(id, 10));
              browser.bookstackOverlay.properties(id, 'bookmark');
            } catch (exHandler) {}
          } else {
            if (notes.length > 0) {
              note = notes.shift();
              // The user may have deleted or viewed an item before its
              // note got to the front of the line.
              try {
                BMSVC.getItemTitle(parseInt(note.id, 10));
                NSVC.nativeNotification(note);
                NSVC.hasNote = true;
              } catch (exHandlerDoNote) {
                NSVC.hasNote = false;
                NSVC.update();
              }
            } else {
              NSVC.hasNote = false;
            }
          }
        }
        return { observe: observer };
      },

      // Kicks off the alerts if they aren't already going.
      update: function () {
        var notes = this.notifications;
        if (this.hasNote || notes.length < 1) {
          return;
        }
        this.nativeNotification(notes.shift());
        this.hasNote = true;
      },

      // The actual alert code, will display native notifications from Fx3.6+
      nativeNotification: function (aNote) {
        var title = bookstack.stack.getString('bookstack-title'),
            bookShelf = bookstack.stack.getShelf(),
            parentFolder;
        try {
          parentFolder = BMSVC.getFolderIdForItem(aNote.id);
        } catch (ex) {}
        if (!parentFolder || parentFolder !== bookShelf) {
          this.hasNote = false;
          this.update();
        } else {
          bookstack.serv.ASVC().showAlertNotification(
            this.NOTE_ICON,
            title,
            aNote.label,
            true,
            aNote.id,
            this.handler(),
            'bookstack-' + aNote.id);
        }
      },

      noteCallback: function (aReason) {
/*        switch (aReason) {
          case 'dismissed':
          case 'removed':
          case 'shown':
          default:
        }*/
      },

      popupNotification: function (aNote) {
        var NSVC = this,
            buttonLabel = bookstack.stack.getString('stack-editbutton'),
            buttonKey = bookstack.stack.getString('stack-editkey'),
            options = {
              persistence: 1,
              timeout: Date.now() + 10000,
              persistWhileVisible: true,
              dismissed: true,
              neverShow: true,
              removeOnDismissal: true
            },
            noteSet = [],
            currentWin = bookstack.serv.getWindow();
        try {
          // Add note to all windows, avoids missing note due to adding from a
          // blurred window (normally would show when focused, but we remove
          // after the timeout)
          bookstack.stack.forEachOpenWindow(function (aWin) {
            noteSet.unshift({
              note: aWin.PopupNotifications.show(
                aWin.getBrowser().selectedBrowser,
                'bookstack-notification-' + aNote.id,
                aNote.label,
                'bookstack-notification-icon',
                null,
                null,
                options),
              window: aWin
            });
            // Show even if the windows aren't focused
            /* FIXME does not show if this is used.
             * var anchor = aWindow.PopupNotifications.iconBox.getElementById(
              'bookstack-notification-icon');
            aWindow.PopupNotifications._update(anchor);*/
          });
          if (!NSVC.notificationTimeout) {
            NSVC.notificationTimeout = bookstack.serv.getWindow().setTimeout(
              NSVC.removeNote, 3000);
          }
        } catch (ex) {}
        NSVC.notifications.push(noteSet);
        NSVC.feedback();
      },

      // aIndex is wrapped in an object (so, aIndex.value) because |setTimeout|
      // on Mozilla adds an extra parameter (how much it missed the mark by).
      removeNote: function (aIndex) {
        var NSVC = bookstack.stack.noteService;
        if (aIndex && aIndex.value) {
          NSVC.notifications.splice(
            aIndex.value, 1)[0].forEach(aNote => aNote.note.remove());
        } else {
          try {
            if (NSVC.notifications.length) {
              NSVC.notifications.pop().forEach(aNote => aNote.note.remove());
            }
          } catch (ex) {}
          if (NSVC.notifications.length) {
            NSVC.notificationTimeout = bookstack.serv.getWindow().setTimeout(
              NSVC.removeNote, 3000);
          } else {
            NSVC.notificationTimeout = null;
          }
        }
      },

      // Add the class to cause animation to fire, per window
      // Animation doesn't necessarily happen once per item added, but rather
      // once per action, so adding ten tabs via 'add all tabs' only fires once
      feedback: function (aElement) {
        var NSVC = this;
        bookstack.stack.forEachOpenWindow(function (aWin) {
          var element = aWin.document.getElementById(
            'bookstack-notification-icon');
          if (element) {
            element.classList.add('bookstack-ping');
            element.addEventListener(
              'animationiteration', NSVC.cleanFeedback, false);
          }
        });
      },

      // Remove animation class after firing
      cleanFeedback: function (aEvent) {
        var NSVC = bookstack.stack.noteService;
        aEvent.target.classList.remove('bookstack-ping');
        aEvent.target.removeEventListener(
          'animationiteration', NSVC.cleanFeedback, false);
      }
    },

    // Wrapper to ping in a new note.
    itemAddedNotification: function (aId, aURI, aTitle) {
      if (bookstack.pref.STACK_NOTIFY.value()) {
        this.noteService.ping({
          label: aTitle || aURI,
          id: aId
        });
      }
    },

    // Wrapper for the built-in bookmark editor dialog.
    properties: function (aItemId, aType) {
      aItemId = parseInt(aItemId, 10);
      if (isNaN(aItemId)) {
        return;
      }
      var info = {
        action: 'edit',
        type: aType,
        itemId: aItemId
      };
      let win = bookstack.serv.getWindow(),
          doc = win.document;
      //FIXME show the whole dialog?
      win.PlacesUIUtils.showBookmarkDialog(info, doc.defaultView);
    },

    // Add the specified URL as a new item in the stack.
    onAddToStackIndex: function (aInfo) {
      var shelf = this.getShelf(),
          bookmarkURI,
          newBookmark;
      if (!aInfo.uri && !aInfo.url) {
        return false;
      }
      bookmarkURI = aInfo.uri || bookstack.serv.getURI(aInfo.url);
      newBookmark = BMSVC.insertBookmark(
        shelf,
        bookmarkURI,
        aInfo.index || BMSVC.DEFAULT_INDEX,
        aInfo.title || bookmarkURI.spec);
      if (aInfo.edit) {
        this.properties(newBookmark, 'bookmark');
      }
      return newBookmark;
    },

    // Returns true if the current stack is empty, otherwise returns false.
    // Empty means no regular bookmarks as direct children.
    checkEmpty: function (aFolder) {
      var folderNode,
          i,
          childNode,
          type,
          empty = true;
      if (!aFolder) {
        aFolder = this.getShelf();
      }
      folderNode = PlacesUtils.getFolderContents(aFolder, false, false).root;
      for (i = 0; empty && i < folderNode.childCount; i += 1) {
        childNode = folderNode.getChild(i);
        type = childNode.type;
        if (type === folderNode.RESULT_TYPE_URI) {
          empty = false;
        } else if (type === folderNode.RESULT_TYPE_FOLDER ||
                   type === folderNode.RESULT_TYPE_REMOTE_CONTAINER) {
          empty = !bookstack.serv.isLivemarkByNode(childNode) &&
                  this.checkEmpty(childNode.itemId);
        }
      }
      folderNode.containerOpen = false;
      return empty;
    },

    // Approximates the utilityOverlay.js behavior for function of same name.
    whereToOpenLink: function (aEvent, aIgnoreButton, aIgnoreAlt) {
      if (!aEvent) {
        return 'current';
      }
      var shiftKey = aEvent.shiftKey,
          ctrlKey = aEvent.ctrlKey,
          metaKey = aEvent.metaKey,
          middle = !aIgnoreButton && aEvent.button === 1,
          middleTab = bookstack.serv.getBoolPref(
            'browser.tabs.opentabfor.middleclick');
      if (metaKey || ctrlKey || (middle && middleTab)) {
        return shiftKey ? 'tabshifted' : 'tab';
      }
      return 'current';
    },

    // Returns the place to open for a simulated plain click event.
    getDefaultAction: function () {
      return this.whereToOpenLink(
        {
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          button: 0
        }, false, false);
    },

    // Wraps popItem to view the first item in stack.
    // This triggers MOVE on the item if it's not REMOVEd.
    popFirst: function (aEvent) {
      var where = this.whereToOpenLink(aEvent, false, false),
          shelf = this.getShelf();
      if (bookstack.stack.checkEmpty(shelf)) {
        return false;
      }
      bookstack.stack.popItem(BMSVC.getIdForItemAt(shelf, 0), where, true);
      return true;
    },

    // Remove/view all the given (arr) items.
    multiPop: function (aItems, aWhere) {
      if (!aWhere) {
        aWhere = this.getDefaultAction();
      }
      var whereMore = 'tab',
          closure = null,
          doBatch;

      if (aItems.length > 1 && aWhere === 'current') {
        // Multiple items need to open in background, except for the first
        if (bookstack.serv.getBoolPref(
          'browser.tabs.loadBookmarksInBackground')) {
          aWhere = 'tab';
          whereMore = 'tabshifted';
        } else {
          aWhere = 'tabshifted';
        }
      }

      closure = {
        items: aItems,
        where: aWhere,
        whereMore: whereMore
      };

      closure.wrappedJSObject = closure;
      doBatch = {
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject;
          closed.items.forEach(function(aItem, aIndex) {
            var where = (aIndex > 0) ? closed.whereMore : closed.where;
            bookstack.stack.popItem(aItem, where);
          });
        }
      };
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
    },

    // Open an item; |where| determines whether it should be in a new
    // tab or the current tab, based on the user's preference and action.
    popItem: function (aId, aWhere, aPop) {
      if (!aId) {
        return;
      }
      function makeCallback() {
        function callback(aIsLivemark, aLivemark) {
          let uriSpec = "",
              index = 0,
              shelf = bookstack.stack.getShelf();
          if (aIsLivemark) {
            bookstack.stack.pushLivemarkFolder(aLivemark, aWhere, aPop);
            return;
          } else if (bookstack.stack.pushFolder(aId) > 0) {
            BMSVC.moveItem(aId, shelf, BMSVC.DEFAULT_INDEX);
            let itemId = BMSVC.getIdForItemAt(shelf, 0);
            bookstack.stack.popItem(itemId, aWhere, aPop);
          }
        }
        return callback;
      }
      aId = parseInt(aId, 10);
      var shelf = this.getShelf(),
          index,
          callback,
          type = BMSVC.getItemType(aId);
      if (this.checkEmpty() ||
          BMSVC.getFolderIdForItem(aId) !== shelf) {
        return;
      }
      index = BMSVC.getItemIndex(aId);
      // separators are treated as their nextSibling's kid brother, so
      // nextSibling gets dragged along when you pop the separator
      if (type === BMSVC.TYPE_SEPARATOR) {
        BMSVC.removeItem(aId);
        aId = BMSVC.getIdForItemAt(shelf, index);
        this.popItem(aId, aWhere, aPop);
      } else if (type === BMSVC.TYPE_FOLDER ||
                 type === BMSVC.TYPE_DYNAMIC_CONTAINER) {
        // Folders and livemarks get moved to the bottom of the stack, with
        // their children added to the top. That process is recursive.
        callback = makeCallback();
        bookstack.serv.getLivemark(aId, callback);
      } else {
        this.openThisIndex(aId, aWhere, aPop);
      }
    },

    // Given an id open that item. See whereToOpenLink for |where|, callback is
    // a function to style the item if the sidebar is open and is removing.
    // |aPop| says to move it to bottom if not removing.
    openThisIndex: function (aId, aWhere, aPop) {
      var uri,
          url,
          browser = bookstack.serv.getBrowser(),
          i = browser.mTabContainer.selectedIndex,
          tab,
          options = {
            inBackground: bookstack.serv.getBoolPref(
              'browser.tabs.loadBookmarksInBackground')
          };
      try {
        uri = BMSVC.getBookmarkURI(aId);
        url = uri.spec;
      } catch (exURI) {
        return false;
      }
      switch (aWhere) {
        case 'tabshifted':
          options.inBackground = !options.inBackground;
          tab = browser.loadOneTab('about:blank', options);
          break;
        case 'tab':
          tab = browser.loadOneTab('about:blank', options);
          break;
        default:
          tab = browser.mTabContainer.childNodes[i];
          break;
      }

      try {
        if (bookstack.pref.STACK_RITEMS.value()) {
          BMSVC.removeItem(aId);
          if (tab.linkedBrowser.currentURI.spec !== 'about:blank') {
            tab.linkedBrowser.loadURI('about:blank');
          }
          // setTimeout to ensure the change is seen if the new tab is focused.
          bookstack.serv.getWindow().setTimeout(function () {
            tab.linkedBrowser.userTypedValue = url;
            tab.linkedBrowser.userTypedClear = 0;
            tab.linkedBrowser.docShell.setCurrentURI(uri);
            try {
              tab.linkedBrowser.contentWindow.history.pushState(null, url, url);
            } catch (ex) {}
            tab.linkedBrowser.loadURI(url);
          }, 100);
        } else {
          tab.linkedBrowser.loadURI(url);
          if (aPop) {
            BMSVC.moveItem(aId, this.getShelf(), BMSVC.DEFAULT_INDEX);
          }
        }
      } catch (exLoad) {}
      return true;
    },

    // Hopefully the fastest way to get this info as it's mostly superficial
    // Add 1 to accommodate the offset (used to not need to because of trash).
    getItemCount: function () {
      // This will be -1 if we're empty.
      let id = BMSVC.getIdForItemAt(this.getShelf(), -1);
      if (id != -1) {
        return BMSVC.getItemIndex(id) + 1;
      }
      return 0;
    },

    pushLivemarkFolder: function(aLivemark, aWhere, aPop) {
      var shelf = this.getShelf(),
          containerNode = PlacesUtils.getFolderContents(aLivemark.id, false,
                                                        false).root,
          children;

      if (!containerNode.containerOpen) {
        // Should never happen (PU.getFolderContents guarantees the root open)
        return;
      }

      children = aLivemark.getNodesForContainer(containerNode);

      for (let child of children) {
        let uri = child.uri;
        let title = child.title;
        BMSVC.insertBookmark(shelf, bookstack.serv.getURI(uri), 0,
                             title || uri);
      }

      containerNode.containerOpen = false;

      if (children.length) {
        BMSVC.moveItem(aLivemark.id, shelf, BMSVC.DEFAULT_INDEX);
        let itemId = BMSVC.getIdForItemAt(shelf, 0);
        this.popItem(itemId, aWhere, aPop);
      } else {
        aLivemark.reload();
      }
    },

    // For a subfolder or livemark, duplicate the items in it recursively,
    // adding them at the top of the stack in their original order
    pushFolder: function (aId, aAdded) {
      var shelf = this.getShelf(),
          folderNode,
          i,
          childNode,
          type,
          childId;
      folderNode = PlacesUtils.getFolderContents(aId, false, false).root;
      if (typeof aAdded === 'undefined') {
        aAdded = 0;
      }
      for (i = 0; i < folderNode.childCount; i += 1) {
        childNode = folderNode.getChild(i);
        type = childNode.type;
        childId = childNode.itemId;
        if (type === folderNode.RESULT_TYPE_FOLDER ||
            type === folderNode.RESULT_TYPE_REMOTE_CONTAINER) {
          aAdded = this.pushFolder(childId, aAdded);
        } else if (type === folderNode.RESULT_TYPE_URI) {
          BMSVC.insertBookmark(
            shelf,
            BMSVC.getBookmarkURI(childId),
            aAdded,
            BMSVC.getItemTitle(childId));
          aAdded += 1;
        } else if (type === folderNode.RESULT_TYPE_SEPARATOR) {
          BMSVC.insertSeparator(shelf, aAdded);
          aAdded += 1;
        }
      }
      folderNode.containerOpen = false;
      return aAdded;
    },

    // Helper to pop up the confirm() question.
    confirmClear: function () {
      return bookstack.serv.getWindow().confirm(this.getString('conftext'));
    },

    // Remove all items from the stack EXCEPT any subfolders and contents.
    // |conf| determines whether a confirmation will be required.
    // Minor bug?
    // on startup after cexit, the treeView.js:245 can't get the children?
    onClrStack: function (aConf) {
      var win = bookstack.serv.getWindow(),
          shelf = this.getShelf(),
          ritems = bookstack.pref.STACK_RITEMS.value(),
          folderNode,
          i,
          childNode,
          type,
          itemSet = [],
          doBatch,
          closure;
      if (aConf && bookstack.pref.STACK_CCLR.value()) {
        if (!this.confirmClear()) {
          return;
        }
        if (!ritems) {
          bookstack.pref.STACK_RITEMS.persist(true);
        }
      }
      folderNode = PlacesUtils.getFolderContents(shelf, false, false).root;
      for (i = 0; i < folderNode.childCount; i += 1) {
        childNode = folderNode.getChild(i);
        type = childNode.type;
        if (type === folderNode.RESULT_TYPE_URI ||
            type === folderNode.RESULT_TYPE_SEPARATOR) {
          itemSet.push(childNode.itemId);
        }
      }
      folderNode.containerOpen = false;
      doBatch = {
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject;
          closed.items.forEach(BMSVC.removeItem);
        }
      };
      closure = { items: itemSet };
      closure.wrappedJSObject = closure;
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
      bookstack.pref.STACK_RITEMS.persist(ritems);
    }
  };
}());

