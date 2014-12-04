/* ***** BEGIN LICENSE BLOCK *****
 *   Version: GPL 2.0
 *
 * Bookstack extension: a queue implementation for bookmarks.
 * Copyright (C) 2007-2011  Adam Dane
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

"use strict";

var bookstack, bookstackSidebar;

if (typeof bookstack === 'undefined') {
  bookstack = (function() {
    return window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
         .getInterface(Components.interfaces.nsIWebNavigation)
         .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
         .rootTreeItem
         .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
         .getInterface(Components.interfaces.nsIDOMWindow).bookstack;
  }());
}

if (typeof bookstackSidebar === 'undefined') {
  bookstackSidebar = {};
}

(function () {
  var {interfaces: Ci, utils: Cu} = Components,
      BMSVC;

  BMSVC = bookstack.serv.BMSVC();
  bookstackSidebar = {
    // Set up folder list, attach the place URI to the tree, and add observers
    init: function () {
      this.bookstackTree = document.getElementById('bookstack-tree-view');
      this.bookstackTree.place = this.getTreePlace();
      if (this.bookstackTree.view.selection.count === 0) {
        this.bookstackTree.view.selection.select(0);
      }
      this.bookstackTree.focus();
      this.prefListenerSet = new bookstack.pref.PrefListener(
        function (aBranch, aPrefName) {
          switch (aPrefName) {
            case 'stack':
              bookstackSidebar.updateTreePlace();
              break;
            case 'stack_middleclick':
              bookstackSidebar.updateMiddl();
              break;
            case 'stack_ritems':
              bookstackSidebar.updateRItButton();
              break;
            case 'stack_cexit':
              bookstackSidebar.updateCExButton();
              break;
          }
        });
      this.prefListenerSet.register();
      window.setTimeout(bookstackSidebar.folderSelect.init, 0);
      bookstack.stack.registerBMO(this.bookstackBMObserver);
      this.updateRItButton();
      this.updateCExButton();
      this.updateMiddl();
      this.updateFilterVisibility();
      this.pendingUpdateStatusbar();
      this.focusHandler();
    },

    // Cleanup function: remove listeners/observers
    done: function () {
      bookstackSidebar.folderSelect.die();
      this.prefListenerSet.unregister();
      bookstack.stack.unregisterBMO(this.bookstackBMObserver);
    },

    // Builds the place URI for the tree.
    getTreePlace: function () {
      return [
        "place:queryType=1&folder=", bookstack.stack.getShelf(),
        "&sort=", this.getTreeSort(),
        "&terms=", this.getTreeSearch()
        ].join("");
    },

    // Used for the Place URI to get the sort parameter value.
    getTreeSort: function () {
      var sortType = parseInt(
        document.getElementById('stack-sort-choice').value, 10),
          sortOrder = parseInt(
        document.getElementById('stack-order').value, 10);
      return (sortOrder === 0) ? 0 : (sortType + sortOrder - 1);
    },

    // Used for the Place URI to get the search parameter value.
    getTreeSearch: function () {
      return document.getElementById('stack-searchbox-text').value;
    },

    // Updates the visibility of the three stack selectors based on the
    // current preferences
    // NOTE: === has (slightly) higher precedence than &.
    updateFilterVisibility: function () {
      var mode = bookstack.pref.STACK_FILTERS.value(),
          values = [
            (mode & 1) === 0, /* === has higher precedence */
            (mode & 2) === 0,
            (mode & 4) === 0
          ],
          ids = [
            [
              'stack-folder-select',
              'stack-filter-select-item'
            ],
            [
              'stack-searchbox',
              'stack-filter-search-item'
            ],
            [
              'stack-sort',
              'stack-filter-sort-item'
            ]
          ];
      values.forEach(function(aValue, aIdx) {
        document.getElementById(ids[aIdx][0]).hidden = aValue;
        document.getElementById(ids[aIdx][1]).setAttribute('checked', !aValue);
      });
    },

    // Sets the visibility of a specific filter based on the preference.
    setVisibility: function (aElementId) {
      var elem = document.getElementById(aElementId),
          mode = bookstack.pref.STACK_FILTERS.value();
      // mode is a three bit mask where:
      //                   0 1 2 3 4 5 6 7
      // 1 = select menu   - x - x - x - x
      // 2 = search field  - - x x - - x x
      // 4 = sort field    - - - - x x x x
      if (elem) {
        elem.hidden = !elem.hidden;
        if (elem.hidden) {
          switch (aElementId) {
          case 'stack-folder-select':
            mode &= 6;
            break;
          case 'stack-searchbox':
            mode &= 5;
            break;
          case 'stack-sort':
            mode &= 3;
            break;
          default:
          }
        } else {
          switch (aElementId) {
          case 'stack-folder-select':
            mode |= 1;
            break;
          case 'stack-searchbox':
            mode |= 2;
            break;
          case 'stack-sort':
            mode |= 4;
            break;
          default:
          }
        }
        bookstack.pref.STACK_FILTERS.persist(mode);
      }
    },

    // Toggles the visibility of one of the filters.
    toggleFilter: function (aFilter) {
      var idList = [
            'stack-folder-select',
            'stack-searchbox',
            'stack-sort'
          ];
      if (aFilter > 2) {
        return;
      }
      this.setVisibility(idList[aFilter]);
    },

    isSorted: function () {
      return (document.getElementById('stack-order').value > 0);
    },

    updateTreePlace: function () {
      this.bookstackTree.place = this.getTreePlace();
      this.pendingUpdateStatusbar();
    },

    // Observe changes to the bookmarks to keep the sidebar statusbar current
    bookstackBMObserver: {
      // the inBatch value allows deferring events until a batch completes
      inBatch: false,

      onBeginUpdateBatch: function () {
        this.inBatch = true;
      },

      onEndUpdateBatch: function () {
        this.inBatch = false;
        bookstackSidebar.pendingUpdateStatusbar();
      },

      // for completeness; not used
      onItemChanged: function (aId, aProp, aB_AnnoP, aValue, aMod, aType,
                               aParentId, aGUID, aParentGUID) {},
      onItemVisited: function (aId, aVisitId, aTime, aTransitionType, aURI,
                               aParentId, aGUID, aParentGUID) {},

      onItemAdded: function (aId, aParentId, aIndex, aType, aURI, aTitle,
                             aDate, aGUID, aParentGUID) {
        if (!this.inBatch && aParentId === bookstack.stack.getShelf()) {
          bookstackSidebar.pendingUpdateStatusbar();
        }
      },

      onItemRemoved: function (aId, aParentId, aIndex, aType, aURI, aGUID,
                               aParentGUID) {
        if (!this.inBatch && aParentId === bookstack.stack.getShelf()) {
          bookstackSidebar.pendingUpdateStatusbar();
        }
      },

      onItemMoved: function (aId, aOldParentId, aOldIdx, aNewParentId, aNewIdx,
                             aType, aGUID, aOldParentGUID, aNewParentGUID) {
        var shelf = bookstack.stack.getShelf();
        if (!this.inBatch && (aNewParentId === shelf ||
            aOldParentId === shelf)) {
          bookstackSidebar.pendingUpdateStatusbar();
        }
      }
    },

    // Shows the number of items in the sidebar's status bar.
    updateStatusbar: function () {
      var bar = document.getElementById('stack-status'),
          shown = bookstackSidebar.getShownCount(),
          total = bookstack.stack.getItemCount(),
          barString = "";
      if (shown < total) {
        barString = [shown, " / "].join("");
      }
      bar.label = [
          [barString, total].join(""),
          bookstack.stack.getString('itemname')
        ].join(" ");
    },

    // Wrapper to give a small delay, or it can update prior to correct count.
    pendingUpdateStatusbar: function () {
      window.setTimeout(bookstackSidebar.updateStatusbar, 100);
    },

    getShownCount: function () {
      return bookstackSidebar.bookstackTree.view.rowCount;
    },

    // Update state of sidebar's Clear on Exit button
    updateCExButton: function () {
      var cexit = document.getElementById('cexit');
      cexit.setAttribute('checked', bookstack.pref.STACK_CEXIT.value());
    },

    // Update state of sidebar's Remove Item button
    updateRItButton: function () {
      var ritems = document.getElementById('ritems');
      ritems.setAttribute('checked', bookstack.pref.STACK_RITEMS.value());
    },

    // Update state of sidebar's Middle Click to Add button
    updateMiddl: function () {
      var middl = document.getElementById('middl');
      middl.setAttribute('checked', bookstack.pref.STACK_MIDCLICK.value());
    },

    // Check whether the |aItem| folder if superior to the |aFolder|.
    // Without this, we could turn ourselves inside out.
    conflict: function (aItem, aFolder) {
      var aParent = BMSVC.getFolderIdForItem(aItem);
      if (BMSVC.getItemType(aItem) === BMSVC.TYPE_BOOKMARK) {
        return false;
      } else if (aItem === aFolder || aParent === aFolder ||
                 aItem === BMSVC.bookmarksMenuFolder) {
        return true;
      } else {
        try {
          aParent = BMSVC.getFolderIdForItem(aFolder);
        } catch (ex) {}
        while (aParent !== BMSVC.bookmarksMenuFolder) {
          if (aParent === aItem) {
            return true;
          }
          aParent = BMSVC.getFolderIdForItem(aParent);
        }
      }
      return false;
    },

    // Helper to return a menu item for the dynamic move to menu.
    giveMenuItem: function (aLabel, aId, aCommand) {
      var aItem = document.createElement('menuitem');
      aItem.setAttribute('label', aLabel);
      aItem.setAttribute('id', aId);
      aItem.addEventListener('command', aCommand, false);
      aItem.classList.add('side-move-menu-item');
      aItem.classList.add('menuitem-iconic');
      return aItem;
    },

    // Helper to return a new popup element.
    givePopup: function (aId, aTitle) {
      var menu = document.createElement('menu'),
          eventCall = bookstackSidebar.moveEvent,
          element = this.giveMenuItem(
            bookstack.stack.getString('thisfolder'), aId, eventCall),
          popup = document.createElement('menupopup');
      element.setAttribute('accesskey', bookstack.stack.getString('tfak'));
      popup.addEventListener(
        'popupshowing', aEvent => aEvent.stopPropagation(), false);
      popup.appendChild(element);
      popup.appendChild(document.createElement('menuseparator'));
      menu.setAttribute('label', aTitle);
      menu.classList.add('side-move-menu');
      menu.classList.add('menu-iconic');
      menu.appendChild(popup);
      return menu;
    },

    // this and the next function work together to create the sidebar context
    // menu's list of folders for the 'move to' submenu.
    fillFolderMenu: function (aEvent) {
      if (aEvent.eventPhase !== aEvent.AT_TARGET) {
        return;
      }
      // The target to be moved upon a destination's selection
      var BMF = BMSVC.bookmarksMenuFolder,
          menuRoot = aEvent.target,
          mId = bookstackSidebar.bookstackTree.selectedNodes[0].itemId,
          eventCall = bookstackSidebar.moveEvent,
          lastFolder = this.getLastFolder(),
          lastMenuName,
          folderNode;
      // clean out any existing nodes from the menu
      while (menuRoot.hasChildNodes()) {
        menuRoot.removeChild(menuRoot.firstChild);
      }
      // If moveTo has been stored, include the last folder for convenience
      // UNLESS, of course, it's a child of this one.
      if (lastFolder !== -1 && !this.conflict(mId, lastFolder)) {
        lastMenuName = [
            bookstack.stack.getString('lastmenu'),
            ["(", BMSVC.getItemTitle(lastFolder), ")"].join('')
          ].join(" ");
        menuRoot.appendChild(
          this.giveMenuItem(lastMenuName, lastFolder, eventCall));
        menuRoot.appendChild(document.createElement('menuseparator'));
      }
      // Add the top folder
      menuRoot.appendChild(
        this.giveMenuItem(BMSVC.getItemTitle(BMF), BMF, eventCall));
      folderNode = PlacesUtils.getFolderContents(BMF, true, false).root;
      this.subMenu(menuRoot, folderNode, mId);
      folderNode.containerOpen = false;
    },

    subMenu: function (aMenu, folderNode, mId) {
      var i,
          menu,
          childNode,
          title,
          id,
          itemsAdded = false;
      for (i = 0; i < folderNode.childCount; i += 1) {
        childNode = folderNode.getChild(i);
        title = childNode.title;
        id = childNode.itemId;
        if (BMSVC.getItemType(id) === BMSVC.TYPE_FOLDER && mId !== id &&
            !bookstack.serv.isLivemarkByNode(childNode)) {
          childNode.QueryInterface(Ci.nsINavHistoryContainerResultNode);
          childNode.containerOpen = true;
          menu = this.givePopup(id, title);
          if (childNode.childCount > 0 &&
              this.subMenu(menu.firstChild, childNode, mId)) {
            aMenu.appendChild(menu);
          } else {
            aMenu.appendChild(
              this.giveMenuItem(title, id, bookstackSidebar.moveEvent));
          }
          itemsAdded = true;
          childNode.containerOpen = false;
        }
      }
      return itemsAdded;
    },

    // The "last folder" is the most recent destination for moving items out of
    // the stack manually; it is convenient if you are moving many items since
    // multi-move isn't supported.
    getLastFolder: function () {
      var last_id = bookstack.pref.LAST_FOLDER.value();
      if (bookstack.stack.doesFolderExist(last_id)) {
        return last_id;
      }
      return -1;
    },

    // Remember where the user last moved items to.
    setLastFolder: function (aFolderId) {
      if (BMSVC.getItemType(aFolderId) === BMSVC.TYPE_FOLDER) {
        bookstack.pref.LAST_FOLDER.persist(aFolderId);
      }
    },

    // for open key (enter)
    popEvent: function (aEvent, aAction) {
      var self = bookstackSidebar,
          tree = self.bookstackTree,
          next = self.getSelectItem(tree, true);
      if (!aAction) {
        aAction = bookstack.stack.whereToOpenLink(aEvent, false, false);
      }
      bookstack.stack.multiPop(self.selectionBMIdArray(tree), aAction);
      if (typeof next !== 'undefined' && bookstack.pref.STACK_RITEMS.value()) {
        window.setTimeout(function () {
          tree.view.selection.select(next);
          tree.treeBoxObject.ensureRowIsVisible(next);
        }, 0);
      }
      this.focusHandler(true);
    },

    // helper for 'move to' menu, executes the moves to selected folder.
    moveEvent: function (aEvent) {
      var tree = bookstackSidebar.bookstackTree,
          next,
          closure,
          doBatch;
      next = bookstackSidebar.getSelectItem(tree);
      closure = {
        items: bookstackSidebar.selectionBMIdArray(tree),
        destId: aEvent.target.getAttribute('id')
      };
      closure.wrappedJSObject = closure;
      doBatch = {
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject,
              destId = closed.destId;
          closed.items.forEach(
            item => BMSVC.moveItem(item, destId, BMSVC.DEFAULT_INDEX));
        }
      };
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
      if (typeof next !== 'undefined') {
        window.setTimeout(function () {
          tree.view.selection.select(next);
          tree.treeBoxObject.ensureRowIsVisible(next);
        }, 0);
      }
      bookstackSidebar.setLastFolder(closure.destId);
    },

    // Returns an array of the indexes of the selected rows.
    selectionArray: function (aTree) {
      var selArray = [],
          tmp;
      for (tmp in this.selectionGenerator(aTree)) {
        selArray.push(tmp);
      }
      return selArray;
    },

    // Returns an array of the nsINavHistoryResult nodes for the selection.
    selectionNodeArray: function (aTree) {
      return this.selectionArray(aTree).map(
        aTree.view.nodeForTreeIndex.bind(aTree.view));
    },

    // Return an array of Places IDs for the selection.
    selectionBMIdArray: function (aTree) {
      return this.selectionNodeArray(aTree).map(
        aNode => aNode ? aNode.itemId : null);
    },

    // The workhorse generator, digs through and gets the selected row indexes.
    selectionGenerator: function (aTree) {
      var selection = aTree.view.selection,
          rangeCount = selection.getRangeCount(),
          start = {},
          end = {},
          i, j;
      for (i = 0; i < rangeCount; i += 1) {
        selection.getRangeAt(i, start, end);
        for (j = start.value; j <= end.value; j += 1) {
          yield j;
        }
      }
    },

    // handles keyboard events on sidebar for accessibility and general use
    sideTreeKey: function (aEvent) {
      var key = aEvent.keyCode || aEvent.charCode;
      if (key === aEvent.DOM_VK_RETURN) {
        this.popEvent(
          aEvent, bookstack.stack.whereToOpenLink(aEvent, false, false));
        aEvent.preventDefault();
        aEvent.stopPropagation();
      }
    },

    // handles hovering of items
    hoverItem: function (aEvent) {
      if (aEvent.target.localName !== 'treechildren') {
        return;
      }
      var tree = bookstackSidebar.bookstackTree,
          node,
          nodeIsURI = false,
          row = {},
          col = {},
          obj = {};
      tree.treeBoxObject.getCellAt(
        aEvent.clientX, aEvent.clientY, row, col, obj);
      if (row.value !== -1) {
        node = tree.view.nodeForTreeIndex(row.value);
      }
      try {
        nodeIsURI = PlacesUtils.nodeIsURI(node);
      } catch (ex) {}
      if (nodeIsURI) {
        bookstackSidebar.setMouseoverURL(node.uri);
        return;
      }
      bookstackSidebar.setMouseoverURL('');
    },

    // Sets the overlink text to the specified item's URI.
    setMouseoverURL: function (aURI) {
      document.defaultView.window.top.XULBrowserWindow.setOverLink(aURI, null);
    },

    // Clicked on a row, open it.
    activateTreeItem: function (aEvent) {
      if (aEvent.target.localName !== 'treechildren' ||
          aEvent.button === 2) {
        return;
      }
      var self = bookstackSidebar,
          tree = self.bookstackTree,
          tbo = tree.treeBoxObject,
          next = self.getSelectItem(tree, true),
          row = {},
          col = {},
          childElt = {};
      tbo.getCellAt(aEvent.clientX, aEvent.clientY, row, col, childElt);

      // Clicked on a non-row
      if (row.value == -1) {
        return;
      }
      // Set selection to the one, clicked item.
      // User can open multiple via context menu, but not normal clicks.
      tbo.view.selection.select(row.value);
      bookstack.stack.multiPop(self.selectionBMIdArray(tree),
        bookstack.stack.whereToOpenLink(aEvent, false, false));
      if (typeof next !== 'undefined' && bookstack.pref.STACK_RITEMS.value()) {
        window.setTimeout(function () {
          tree.view.selection.select(next);
          tbo.ensureRowIsVisible(next);
        }, 0);
      }
      self.focusHandler(true);
      aEvent.preventDefault();
      aEvent.stopPropagation();
    },

    // Refocuses the sidebar if needed.
    focusHandler: function (aIsOpening) {
      var tree = bookstackSidebar.bookstackTree,
          start = {},
          end = {};
      // If it's an event-based call and it's a focus or blur on the window?
      // When the hell should the selected index be visible for focus/blur?
      if (aIsOpening) {
        // only when we just opened an item and want to make sure
        // the newly selected item is visible to the user.
        if (tree.view.selection.count > 0) {
          tree.view.selection.getRangeAt(0, start, end);
          tree.treeBoxObject.ensureRowIsVisible(start.value);
        }
        if (bookstack.pref.STACK_FOCUS.value()) {
          tree.focus();
        } else {
          bookstack.serv.getBrowser().contentWindow.focus();
        }
      }
    },

    // For multiselect removal; get next item index after last selected item.
    //   OR get the last index when subtracting the selection (if selection is
    //   at end)
    getSelectItem: function (aTree, aPop) {
      if (typeof aTree === 'undefined') {
        return null;
      }
      var selectedCount = 0,
          diff,
          maxIndex,
          selectionArray;
      if (aPop && this.allFolders(this.selectionNodeArray(aTree))) {
        return 0;
      }
      if (aTree.view.selection) {
        selectedCount = aTree.view.selection.count;
      }
      diff = aTree.view.rowCount - selectedCount;
      if (diff === 0 || selectedCount === 0) {
        //can't select! no items!
        return null;
      }
      selectionArray = this.selectionArray(aTree);
      if (selectionArray.length) {
        maxIndex = selectionArray.reduce(
          (aItem, bItem) => aItem > bItem ? aItem : bItem);
      } else {
        maxIndex = 0;
      }
      return Math.min(maxIndex - selectedCount + 1, diff - 1);
    },

    allType: function(aSelectedItems, aType) {
      if (aSelectedItems.length == 0) {
        return false;
      }
      return aSelectedItems.every(function(aItem) {
        if (!aItem) {
          return false;
        }
        return aItem.type === aType;
      });
    },

    allSeparators: function(aSelectedItems) {
      return this.allType(
        aSelectedItems, Ci.nsINavHistoryResultNode.RESULT_TYPE_SEPARATOR);
    },

    allFolders: function(aSelectedItems) {
      return this.allType(
        aSelectedItems, Ci.nsINavHistoryResultNode.RESULT_TYPE_FOLDER);
    },

    // Based on the Places Controller (places/content/controller.js)
    updateCommands: function () {
      var tree = bookstackSidebar.bookstackTree,
          nodes = bookstackSidebar.selectionNodeArray(tree),
          commands = ['copy', 'cut', 'paste', 'delete', 'show:info', 'reload'];
      if (!nodes[0]) {
        return;
      }
      function updateCommand(aCommand) {
        var node = document.getElementById('stackwrap_placesCmd_' + aCommand),
            controller = top.document.commandDispatcher.getControllerForCommand(
              'placesCmd_' + aCommand),
            enabled;
        if (controller) {
          enabled = controller.isCommandEnabled('placesCmd_' + aCommand);
        }
        if (node) {
          if (enabled) {
            node.removeAttribute('disabled');
          } else {
            node.setAttribute('disabled', "true");
          }
        }
      }
      commands.forEach(updateCommand);
    },

    // Disables items that don't apply to multiples,
    // Reorders the open in (this|new) tab based on preferences
    fixupSidePop: function (aEvent) {
      if (aEvent.eventPhase !== aEvent.AT_TARGET) {
        return;
      }

      var tree = bookstackSidebar.bookstackTree,
          multiselect = tree.view.selection.count > 1,
          nodes = bookstackSidebar.selectionNodeArray(tree),
          allSeparators = this.allSeparators(nodes),
          ids = bookstackSidebar.selectionBMIdArray(tree),
          cantEdit = multiselect || allSeparators,
          thisTab = document.getElementById('side-open-this'),
          newTab = document.getElementById('side-open-new'),
          editItem = document.getElementById('side-details-edit'),
          reloadItem = document.getElementById('side-reload');

      // Once again... need setTimeout for gods know why...
      window.setTimeout(function() {
        editItem.disabled = multiselect || allSeparators;
      }, 0);
      thisTab.disabled = multiselect || allSeparators;
      newTab.disabled = allSeparators;
      reloadItem.disabled = true;

      if (!multiselect && !allSeparators && ids[0]) {
        this.enableForLivemark(ids[0], reloadItem);
      }
    },

    enableForLivemark: function (aId, aItem) {
      function completeEnable(aBool) {
        aItem.disabled = !aBool;
      }
      bookstack.serv.isLivemark(aId, completeEnable);
    },

    // Wraps for calls to the Places-provided commands.
    wrapCmd: function (aCommand) {
      top.document.commandDispatcher.getControllerForCommand(
        aCommand).doCommand(aCommand);
    },

    // Determine open menuitem target
    menuActivateItem: function (aEvent, aType) {
      var action = bookstack.stack.getDefaultAction();
      if (aType === 1) {
        action = action === 'current' ? 'tab' : 'tabshifted';
      }
      this.popEvent(aEvent, action);
    }
  };
}());

