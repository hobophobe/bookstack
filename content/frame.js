
"use strict";

var bookstackPref;

(function () {
  var {classes: Cc, interfaces: Ci} = Components;

  bookstackPref = {
    // Preferences Service
    PSVC: function () {
      return Cc["@mozilla.org/preferences-service;1"].
             getService(Ci.nsIPrefService);
    },

    getBranch: function () {
      return this.PSVC().getBranch('extensions.bookstack.');
    },

    MOD_KEY: function () {
      return this.getBranch().getBoolPref('stack_modifierkey');
    },

    MIDCLICK: function () {
      return this.getBranch().getBoolPref('stack_middleclick');
    }
  };

}());

const bookstackNS = "bookstack@{3dba5b22-2e1a-11dc-8314-0800200c9a66}";

function maybeUsurpMiddleClick(aEvent) {
  let target = aEvent.target,
      linkNode,
      parent,
      isModified = aEvent.ctrlKey || aEvent.metaKey,
      win = getTopWindow(target.ownerDocument.defaultView),
      text;
  if (!bookstackPref.MIDCLICK() || aEvent.button !== 1 ||
     (!isModified && bookstackPref.MOD_KEY())) {
    return false;
  }
  if (isALink(target)) {
    if (target.hasAttribute('href')) {
      linkNode = target;
    }
    parent = target.parentNode;
    while (parent) {
      if (isALink(parent) && parent.hasAttribute('href')) {
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
    text = gatherTextUnder(linkNode);
    if (!text || !text.match(/\S/)) {
      text = linkNode.getAttribute('title');
    }
    if (!text || !text.match(/\S/)) {
      text = linkNode.getAttribute('alt');
    }
    if (!text || !text.match(/\S/)) {
      text = linkNode.linkURL;
    }
    sendAsyncMessage(bookstackNS + ":add", {
      url: linkNode.href,
      title: text,
      edit: aEvent.shiftKey
    });
    aEvent.preventDefault();
    aEvent.stopPropagation();
    return true;
  }
  return false;
}

function isALink(aNode) {
  let win = getTopWindow(aNode.ownerGlobal);
  return (aNode instanceof win.HTMLAnchorElement ||
          aNode instanceof win.HTMLAreaElement ||
          aNode instanceof win.HTMLLinkElement);
}

function getTopWindow(aWindow) {
  let Ci = Components.interfaces;
  return aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIWebNavigation)
                .QueryInterface(Ci.nsIDocShellTreeItem)
                .rootTreeItem
                .QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindow);
}

// Taken from m-c/browser/base/content/utilityOverlay.js
// Gather all descendent text under given document node.
function gatherTextUnder ( root )
{
  var text = "";
  var node = root.firstChild;
  var depth = 1;
  while ( node && depth > 0 ) {
    // See if this node is text.
    if ( node.nodeType == content.Node.TEXT_NODE ) {
      // Add this text to our collection.
      text += " " + node.data;
    } else if ( node instanceof HTMLImageElement) {
      // If it has an "alt" attribute, add that.
      var altText = node.getAttribute( "alt" );
      if ( altText && altText != "" ) {
        text += " " + altText;
      }
    }
    // Find next node to test.
    // First, see if this node has children.
    if ( node.hasChildNodes() ) {
      // Go to first child.
      node = node.firstChild;
      depth++;
    } else {
      // No children, try next sibling (or parent next sibling).
      while ( depth > 0 && !node.nextSibling ) {
        node = node.parentNode;
        depth--;
      }
      if ( node.nextSibling ) {
        node = node.nextSibling;
      }
    }
  }
  // Strip leading and tailing whitespace.
  text = text.trim();
  // Compress remaining whitespace.
  text = text.replace( /\s+/g, " " );
  return text;
}

function handleUnload(aMessage) {
    removeEventListener('click', maybeUsurpMiddleClick, true);
    removeMessageListener(bookstackNS + ":unload", handleUnload);
}

addEventListener('click', maybeUsurpMiddleClick, true, true);
addMessageListener(bookstackNS + ":unload", handleUnload);
