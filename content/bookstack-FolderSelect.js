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

"use strict";

var bookstack, bookstackSidebar;

(function () {
  var {interfaces: Ci, utils: Cu} = Components,
      BMSVC = bookstack.serv.BMSVC(),
      folderSelect;

  try {
    Cu['import']("resource://gre/modules/PlacesUtils.jsm");
  } catch (exPlaces) {}

  folderSelect = {
    XUL_NS: "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",

    init: function () {
      bookstack.stack.registerBMO(folderSelect.FolderObserver);
      folderSelect.prefListenerSet = new bookstack.pref.PrefListener(
        function (aBranch, aPrefName) {
          switch (aPrefName) {
            case 'stack':
              folderSelect.fillMenu();
              break;
          }
        });
      folderSelect.prefListenerSet.register();
      folderSelect.fillMenu();
    },

    die: function () {
      bookstack.stack.unregisterBMO(folderSelect.FolderObserver);
      folderSelect.prefListenerSet.unregister();
    },

    selectFolder: function (aEvent) {
      bookstack.pref.STACK_FOLDER.persist(aEvent.target.id);
      this.fillMenu();
    },

    fillMenu: function () {
      var popup = document.getElementById('select-stack'),
          folder = BMSVC.bookmarksMenuFolder,
          folderNode;

      while (popup.hasChildNodes()) {
        popup.removeChild(popup.firstChild);
      }

      folderNode = PlacesUtils.getFolderContents(folder, true, false).root;
      this.fillFolder(popup, folderNode, 0, bookstack.stack.getShelf());
      folderNode.containerOpen = false;
      if (popup.parentNode.selectedIndex === -1) {
        popup.parentNode.selectedIndex = 0;
      }
    },

    fillFolder: function (aPopup, folderNode, aDepth, aCurrent) {
      var i,
          childNode,
          type,
          title,
          id,
          element,
          label,
          image;

      for (i = 0; i < folderNode.childCount; i += 1) {
        childNode = folderNode.getChild(i);
        type = childNode.type;
        title = childNode.title;
        id = childNode.itemId;
        if (BMSVC.getItemType(id) === BMSVC.TYPE_FOLDER &&
            !bookstack.serv.isLivemarkByNode(childNode)) {
          childNode.QueryInterface(Ci.nsINavHistoryContainerResultNode);
          childNode.containerOpen = true;
          element = document.createElementNS(this.XUL_NS, 'menuitem');
          /* 2 + 16 is for icon (16x16) and its padding (1px per side) */
          element.setAttribute('style',
            "padding-left: " + (2 + 16 * aDepth) + "px;");
          element.classList.add('menuitem-iconic');
          // Needed for when it's the selected item
          element.setAttribute('label', title);
          element.setAttribute('id', id);
          image = document.createElementNS(this.XUL_NS, 'image');
          image.setAttribute('src', "");
          image.classList.add('select-stack-icon');
          element.appendChild(image);
          label = document.createElementNS(this.XUL_NS, 'label');
          label.setAttribute('value', title);
          element.appendChild(label);
          aPopup.appendChild(element);
          if (id === aCurrent) {
            aPopup.parentNode.selectedItem = element;
          }
          this.fillFolder(aPopup, childNode, aDepth + 1, aCurrent);
          childNode.containerOpen = false;
        }
      }
    },

    // Observe changes to the bookmarks to keep the sidebar current
    FolderObserver: {
      // inBatch allows to defer until a batch completes
      inBatch: false,
      onBeginUpdateBatch: function () {
        this.inBatch = true;
      },

      onEndUpdateBatch: function () {
        this.inBatch = false;
        folderSelect.fillMenu();
      },

      // for completeness; not used
      onItemVisited: function (aId, aVId, aTime, aTransitionType, aURI,
                               aParentId, aGUID, aParentGUID) {},
      onItemAdded: function (aId, aParentId, aIndex, aType, aURI, aTitle, aDate,
                             aGUID, aParentGUID) {
        if (!this.inBatch) {
          let shelf = bookstack.stack.getShelf();
          if (aParentId === shelf && aType === BMSVC.TYPE_FOLDER) {
            folderSelect.fillMenu();
          }
        }
      },

      onItemRemoved: function (aId, aParentId, aIndex, aType, aURI, aGUID,
                               aParentGUID) {
        if (!this.inBatch) {
          let shelf = bookstack.stack.getShelf();
          if (aParentId === shelf && aType === BMSVC.TYPE_FOLDER) {
            folderSelect.fillMenu();
          }
        }
      },

      onItemChanged: function (aId, aProp, aB_AnnoP, aValue, aMod, aType,
                               aParentId, aGUID, aParentGUID) {
        if (!this.inBatch && aProp === 'title') {
          let shelf = bookstack.stack.getShelf();
          if (aParentId === shelf && aType === BMSVC.TYPE_FOLDE) {
            folderSelect.fillMenu();
          }
        }
      },

      onItemMoved: function (aId, aOldParentId, aOldIdx, aNewParentId, aNewIdx,
                             aType, aGUID, aOldParentGUID, aNewParentGUID) {
        if (!this.inBatch) {
          let shelf = bookstack.stack.getShelf();
          if (aType === BMSVC.TYPE_FOLDER && (aOldParentId === shelf ||
              aNewParentId === shelf)) {
            folderSelect.fillMenu();
          }
        }
      }
    }
  };
  bookstackSidebar.folderSelect = folderSelect;
}());

