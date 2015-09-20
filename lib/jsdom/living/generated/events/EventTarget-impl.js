"use strict";
const DOMException = require("../../../web-idl/DOMException");
const reportException = require("../../helpers/runtime-script-errors");
const domSymbolTree = require("../../helpers/internal-constants").domSymbolTree;
const idlUtils = require("../util");

const Event = require("./Event").interface;

class EventTargetImpl {
  constructor() {
    this._eventListeners = {};
  }

  addEventListener(type, callback, capture) {
    // webidl2js currently can't handle neither optional arguments nor callback interfaces
    if (callback === undefined || callback === null) {
      callback = null;
    } else if (typeof callback === "object") {
      callback = callback.handleEvent;
    } else if (typeof callback !== "function") {
      throw new TypeError("Only undefined, null, an object, or a function are allowed for the callback parameter");
    }

    capture = Boolean(capture);

    if (callback === null) {
      return;
    }

    if (!this._eventListeners[type]) {
      this._eventListeners[type] = [];
    }

    for (let i = 0; i < this._eventListeners[type].length; ++i) {
      const listener = this._eventListeners[type][i];
      if (listener.capture === capture && listener.callback === callback) {
        return;
      }
    }

    this._eventListeners[type].push({
      callback,
      capture
    });
  }

  removeEventListener(type, callback, capture) {
    if (callback === undefined || callback === null) {
      callback = null;
    } else if (typeof callback === "object") {
      callback = callback.handleEvent;
    } else if (typeof callback !== "function") {
      throw new TypeError("Only undefined, null, an object, or a function are allowed for the callback parameter");
    }

    capture = Boolean(capture);

    if (callback === null) {
      // Optimization, not in the spec.
      return;
    }

    if (!this._eventListeners[type]) {
      return;
    }

    for (let i = 0; i < this._eventListeners[type].length; ++i) {
      const listener = this._eventListeners[type][i];
      if (listener.callback === callback && listener.capture === capture) {
        this._eventListeners[type].splice(i, 1);
        break;
      }
    }
  }

  dispatchEvent(event) {
    if (!(event instanceof Event)) {
      throw new TypeError("Argument to dispatchEvent must be an Event");
    }

    const eventImpl = idlUtils.implForWrapper(event, "Event");
    if (eventImpl._dispatchFlag || !eventImpl._initializedFlag) {
      throw new DOMException(DOMException.INVALID_STATE_ERR, "Tried to dispatch an uninitialized event");
    }

    eventImpl.isTrusted = false;

    return this._dispatch(event);
  }

  _dispatch(event, targetOverride) {
    const eventImpl = idlUtils.implForWrapper(event, "Event");
    eventImpl._dispatchFlag = true;
    eventImpl.target = targetOverride || idlUtils.wrapperForImpl(this);

    const eventPath = [];
    let targetParent = domSymbolTree.parent(eventImpl.target);
    let target = eventImpl.target;
    while (targetParent) {
      eventPath.push(targetParent);
      target = targetParent;
      targetParent = domSymbolTree.parent(targetParent);
    }
    if (event.type !== "load" && target._defaultView) { // https://html.spec.whatwg.org/#events-and-the-window-object
      eventPath.push(target._defaultView);
    }

    eventImpl.eventPhase = Event.CAPTURING_PHASE;
    for (let i = eventPath.length - 1; i >= 0; --i) {
      if (eventImpl._stopPropagationFlag) break;
      const object = eventPath[i];
      const objectImpl = idlUtils.implForWrapper(object, "EventTarget");
      const eventListeners = objectImpl._eventListeners[event.type];
      invokeEventListeners(eventListeners, object, event);
    }

    eventImpl.eventPhase = Event.AT_TARGET;
    if (!eventImpl._stopPropagationFlag && this._eventListeners[event.type]) {
      const eventListeners = this._eventListeners[event.type];
      invokeEventListeners(eventListeners, eventImpl.target, event);
    }

    if (event.bubbles) {
      eventImpl.eventPhase = Event.BUBBLING_PHASE;
      for (let i = 0; i < eventPath.length; ++i) {
        if (eventImpl._stopPropagationFlag) break;
        const object = eventPath[i];
        const objectImpl = idlUtils.implForWrapper(object, "EventTarget");
        const eventListeners = objectImpl._eventListeners[event.type];
        invokeEventListeners(eventListeners, object, event);
      }
    }

    eventImpl._dispatchFlag = false;
    eventImpl.eventPhase = Event.NONE;
    eventImpl.currentTarget = null;
    return !eventImpl._canceledFlag;
  }
}

module.exports = {
  implementation: EventTargetImpl
};

function invokeEventListeners(listeners, target, event) {
  const eventImpl = idlUtils.implForWrapper(event, "Event");
  eventImpl.currentTarget = target;
  if (!listeners) return;

  listeners = listeners.slice();
  for (let i = 0; i < listeners.length; ++i) {
    if (eventImpl._stopImmediatePropagationFlag) return;
    const listener = listeners[i];
    if (event.eventPhase === Event.CAPTURING_PHASE && !listener.capture) continue;
    if (event.eventPhase === Event.BUBBLING_PHASE && listener.capture) continue;

    try {
      listener.callback.call(eventImpl.currentTarget, event);
    } catch (e) {
      const window = target._document ? target : target._ownerDocument._defaultView;

      if (window) {
        reportException(window, e);
      }
      // Errors in window-less documents just get swallowed... can you think of anything better?
    }
  }
}

function forwardIterator(list) {
  let i = 0;
  const len = list.length;
  return function iterator() {
    return i < len ? list[i++] : null;
  };
}

function backwardIterator(list) {
  let i = list.length;
  return function iterator() {
    return i >= 0 ? list[--i] : null;
  };
}

function singleIterator(obj) {
  let i = 1;
  return function iterator() {
    return i-- ? obj : null;
  };
}

function dispatchPhase(event, iterator) {
  let target = iterator();

  while (target && !event._stopPropagation) {
    if (event._eventPhase === event.CAPTURING_PHASE || event.eventPhase === event.AT_TARGET) {
      callListeners(event, target, getListeners(target, event._type, true));
    }
    if (event._eventPhase === event.AT_TARGET || event.eventPhase === event.BUBBLING_PHASE) {
      callListeners(event, target, getListeners(target, event._type, false));
    }
    target = iterator();
  }
}

function callListeners(event, target, listeners) {
  const eventImpl = idlUtils.implForWrapper(event, "Event");
  var currentListener = listeners.length;
  while (currentListener--) {
    eventImpl.currentTarget = target;
    try {
      listeners[currentListener].call(target, event);
    } catch (e) {
      const window = target._document ? target : target._ownerDocument._defaultView;

      if (window) {
        reportException(window, e);
      }
      // Errors in window-less documents just get swallowed... can you think of anything better?
    }
  }
}

function getListeners(target, type, capturing) {
  let listeners;
  const impl = idlUtils.implForWrapper(target, "EventTarget");
  if (impl._events[type]) {
    listeners = impl._events[type][capturing ? "capturing" : "bubbling"];
  } else {
    listeners = [];
  }

  if (!capturing) {
    const inlineListener = getListenerForInlineEventHandler(target, type);
    if (inlineListener) {
      const document = target._ownerDocument || target._document;

      // Will be falsy for windows that have closed
      if (document) {
        const implementation = document.implementation;

        if (implementation._hasFeature("ProcessExternalResources", "script")) {
          if (listeners.indexOf(inlineListener) === -1) {
            listeners.push(inlineListener);
          }
        }
      }
    }
  }
  return listeners;
}

const wrappedListener = Symbol("inline event listener wrapper");

function getListenerForInlineEventHandler(target, type) {
  const callback = target["on" + type];

  if (!callback) { // TODO event handlers: only check null
    return null;
  }

  if (!callback[wrappedListener]) {
    // https://html.spec.whatwg.org/multipage/webappapis.html#the-event-handler-processing-algorithm
    callback[wrappedListener] = function (E) {
      const isWindowError = E.constructor.name === "ErrorEvent" && type === "error"; // TODO branding

      let returnValue;
      if (isWindowError) {
        returnValue = callback.call(E.currentTarget, E.message, E.filename, E.lineno, E.colno, E.error);
      } else {
        returnValue = callback.call(E.currentTarget, E);
      }

      if (type === "mouseover" || isWindowError) {
        if (returnValue) {
          E.preventDefault();
        }
      } else if (!returnValue) {
        E.preventDefault();
      }
    };
  }

  return callback[wrappedListener];
}
