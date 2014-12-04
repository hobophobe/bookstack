/* ***** BEGIN LICENSE BLOCK *****
 *   Version: GPL 2.0
 *
 * Bookstack extension: a queue implementation for bookmarks.
 * Copyright (C) 2007-2011 Adam Dane
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

var dnd,
    EXPORTED_SYMBOLS = ['dnd'];

(function () {
  var Cu = Components.utils,
      BMSVC, bookstack;

  try {
    Cu['import']("resource://gre/modules/PlacesUtils.jsm");
  } catch (exPlaces) {}

  dnd = {
    init: function (aBookstack) {
      bookstack = aBookstack;
      BMSVC = bookstack.serv.BMSVC();
    },
    // Convenience array of supported drag MIME types.
    types: [
      PlacesUtils.TYPE_X_MOZ_PLACE,
      PlacesUtils.TYPE_X_MOZ_URL,
      PlacesUtils.TYPE_UNICODE,
      'text/plain',
      'application/x-moz-tabbrowser-tab'
    ],

    // checks event data against supported types
    canDrop: function (aEvent, aIndex) {
      var types;
      if (!aEvent.dataTransfer) {
        return false;
      }
      types = bookstack.dnd.types;
      return types.some(function(aType) {
        if (aEvent.dataTransfer.types.contains(aType)) {
          if (aType === PlacesUtils.TYPE_UNICODE || aType === 'text/plain') {
            try {
              bookstack.serv.getURI(aEvent.dataTransfer.mozGetDataAt(aType, 0));
              return true;
            } catch (ex) {
              return false;
            }
          } else {
            return true;
          }
        }
        return false;
      });
    },

    // based on the Places handler dragNdrop
    onDrop: function (aEvent, aIndex, aShelf) {
      var items = [],
          types = bookstack.dnd.types,
          copy = (aEvent.dataTransfer.dropEffect === 'copy'),
          count = aEvent.dataTransfer.mozItemCount,
          i,
          j,
          data,
          doBatch,
          closure;
      for (i = 0; i < count; i += 1) { /* For each dropped item */
        for (let type of types) {
          if (aEvent.dataTransfer.mozTypesAt(i).contains(type)) {
            data = aEvent.dataTransfer.mozGetDataAt(type, i);
            if (data) {
              items.push([data, type, aIndex, copy, aShelf]);
              break;
            }
          }
        }
      }
      doBatch = {
        doADrop: function (aItem) {
          var [data, type, index, copy, container] = aItem,
              URI,
              parts;
          switch (type) {
            case PlacesUtils.TYPE_X_MOZ_PLACE:
              data = PlacesUtils.unwrapNodes(data, type)[0];
              if (copy) {
                switch (data.type) {
                case PlacesUtils.TYPE_X_MOZ_PLACE:
                  return this.copyItem(data, container, index);
                case PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER:
                  return this.copyFolder(data, container, index);
                case PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR:
                  return BMSVC.insertSeparator(container, index);
                default:
                  return null;
                }
              } else {
                return BMSVC.moveItem(data.id, container, index);
              }
            case 'text/plain':
            case PlacesUtils.TYPE_UNICODE:
              URI = bookstack.serv.getURI(data);
              return BMSVC.insertBookmark(container, URI, index, data);
            case 'application/x-moz-tabbrowser-tab':
              URI = bookstack.serv.getURI(
                data.linkedBrowser.webNavigation.currentURI.spec);
              return BMSVC.insertBookmark(container, URI, index, data.label);
            case PlacesUtils.TYPE_X_MOZ_URL:
              parts = data.split('\n');
              URI = bookstack.serv.getURI(parts[0]);
              return BMSVC.insertBookmark(container, URI, index, parts[1]);
            default:
              return null;
          }
        },

        // Special copier for livemarks that keeps their attached properties
        // consistent.
        copyLivemark: function (aData, aContainer, aIndex) {
          let LMSVC = bookstack.serv.LMSVC();
          function callback(aBoolResult, aLivemark) {
            if (aBoolResult) {
              let lmInfo = {
                parentId: aContainer,
                index: aIndex || BMSVC.DEFAULT_INDEX,
                feedURI: aLivemark.feedURI
              };
              if ('siteURI' in aLivemark)
                lmInfo['siteURI'] = aLivemark.siteURI;
              LMSVC.addLivemark(lmInfo);
            }
          }
          LMSVC.getLivemark(aData.id, callback);
        },

        // copying a folder includes its children and the properties.
        copyFolder: function (aData, aContainer, aIndex) {
          var self = this,
              aFolderId;
          function addChildItems(aChildren, aFolder) {
            aChildren.forEach(function(aNode) {
              switch (aNode.type) {
                case PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER:
                  self.copyFolder(aNode, aFolder, i);
                  break;
                case PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR:
                  BMSVC.insertSeparator(aFolder, i);
                  break;
                case PlacesUtils.TYPE_X_MOZ_PLACE:
                  self.copyItem(aNode, aFolder, i);
                  break;
                default:
              }
            });
          }
          if (aData.livemark && aData.annos) {
            self.copyLivemark(aData, aContainer, aIndex);
          } else {
            aFolderId = BMSVC.createFolder(aContainer, aData.title, aIndex);
            addChildItems(aData.children, aFolderId);
            if (aData.annos) {
              BMSVC.setAnnotationsForItem(aFolderId, aData.annos);
            }
          }
        },

        // simple item copy, includes its properties.
        copyItem: function (aData, aContainer, aIndex) {
          var itemURL = bookstack.serv.getURI(aData.uri),
              itemTitle = aData.title,
              keyword = aData.keyword || null,
              annos = aData.annos || [],
              bookmarkId = BMSVC.insertBookmark(
                aContainer, itemURL, aIndex, itemTitle);
          if (keyword) {
            BMSVC.setKeywordForBookmark(bookmarkId, keyword);
          }
          if (annos && annos.length > 0) {
            PlacesUtils.setAnnotationsForItem(bookmarkId, annos);
          }
        },

        // passed to BMSVC.runInBatchMode() so that observers catch the batch
        // event and don't rebuild the sidebar constantly on multi-item drops
        runBatched: function (aUserData) {
          var closed = aUserData.wrappedJSObject,
              items = closed.items;
          items.forEach(this.doADrop, this);
        }
      };
      // Because the opaque value must be of nsISupports
      closure = {
        items: items
      };
      closure.wrappedJSObject = closure;
      try {
        BMSVC.runInBatchMode(doBatch, closure);
      } catch (ex) {}
    }
  };
}());

