﻿/*jshint curly: true, eqeqeq: true, immed: true, newcap: true, noarg: true, nonew: true, undef: true, white: true, trailing: true, evil: true */

/* setImmediate.js
 *
 * A cross-browser setImmediate and clearImmediate:
 * https://dvcs.w3.org/hg/webperf/raw-file/tip/specs/setImmediate/Overview.html
 * Uses one of the following implementations:
 *  - Native msSetImmediate/msClearImmediate in IE10
 *  - MessageChannel in supporting (very recent) browsers: advantageous because it works in a web worker context
 *  - postMessage in Firefox 3+, Internet Explorer 9+, WebKit, and Opera 9.5+ (except where MessageChannel is used)
 *  - setTimeout(..., 0) in all other browsers
 * In other words, setImmediate and clearImmediate are safe in all browsers.
 *
 * Copyright © 2011 Barnesandnoble.com llc, Donavon West, and Domenic Denicola
 * Released under MIT license (see MIT-LICENSE.txt)
 */

(function (global) {
	"use strict";

    var tasks = (function () {
        function Task(handler, args) {
            this.handler = handler;
            this.args = Array.prototype.slice.call(args);
        }
        Task.prototype.run = function () {
            // See steps in section 5 of the spec.
            if (typeof this.handler === "function") {
                // Choice of `thisArg` is not in the setImmediate spec; undefined is specified in setTimeout spec though:
                // http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html
                this.handler.apply(undefined, this.args);
            } else {
                var scriptSource = "" + this.handler;
                eval(scriptSource);
            }
        };

        var nextHandle = 1; // Spec says greater than zero
        var tasksByHandle = {};

        return {
            addFromSetImmediateArguments: function (args) {
                var handler = args[0];
                var argsToHandle = Array.prototype.slice.call(args, 1);
                var task = new Task(handler, argsToHandle);

                var thisHandle = nextHandle++;
                tasksByHandle[thisHandle] = task;
                return thisHandle;
            },
            runIfPresent: function (handle) {
                var task = tasksByHandle[handle];
                if (task) {
                    task.run();
                    delete tasksByHandle[handle];
                }
            },
            remove: function (handle) {
                delete tasksByHandle[handle];
            }
        };
    }());

    function hasMicrosoftImplementation() {
        return !!(global.msSetImmediate && global.msClearImmediate);
    }

    function canUseMessageChannel() {
        return !!global.MessageChannel;
    }

    function canUsePostMessage() {
        // The test against `importScripts` prevents this implementation from being installed inside a web worker,
        // where `global.postMessage` means something completely different and can't be used for this purpose.

        if (!global.postMessage || global.importScripts) {
            return false;
        }

        var postMessageIsAsynchronous = true;
        var oldOnMessage = global.onmessage;
        global.onmessage = function () {
            postMessageIsAsynchronous = false;
        };
        global.postMessage("", "*");
        global.onmessage = oldOnMessage;

        return postMessageIsAsynchronous;
    }

    function aliasMicrosoftImplementation(attachTo) {
        attachTo.setImmediate = global.msSetImmediate;
        attachTo.clearImmediate = global.msClearImmediate;
    }

    function installMessageChannelImplementation(attachTo) {
        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            // Create a channel and immediately post a message to it with the current handle.
            var channel = new global.MessageChannel();
            channel.port1.onmessage = function () {
                tasks.runIfPresent(handle);
            };
            channel.port2.postMessage();

            return handle;
        };
    }

    function installPostMessageImplementation(attachTo) {
        // Installs an event handler on `global` for the `message` event: see
        // * https://developer.mozilla.org/en/DOM/window.postMessage
        // * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages

        var MESSAGE_PREFIX = "com.bn.NobleJS.setImmediate" + Math.random();

        function isStringAndStartsWith(string, putativeStart) {
            return typeof string === "string" && string.substring(0, putativeStart.length) === putativeStart;
        }

        function onGlobalMessage(event) {
            // This will catch all incoming messages (even from other windows!), so we need to try reasonably hard to
            // avoid letting anyone else trick us into firing off. We test the origin is still this window, and that a
            // (randomly generated) unpredictable identifying prefix is present.
            if (event.source === global && isStringAndStartsWith(event.data, MESSAGE_PREFIX)) {
                var handle = event.data.substring(MESSAGE_PREFIX.length);
                tasks.runIfPresent(handle);
            }
        }
        if (global.addEventListener) {
            global.addEventListener("message", onGlobalMessage, false);
        } else {
            global.attachEvent("onmessage", onGlobalMessage);
        }

        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);

            // Make `global` post a message to itself with the handle and identifying prefix, thus asynchronously
            // invoking our onGlobalMessage listener above.
            global.postMessage(MESSAGE_PREFIX + handle, "*");

            return handle;
        };
    }

    function installSetTimeoutImplementation(attachTo) {
        attachTo.setImmediate = function () {
            var handle = tasks.addFromSetImmediateArguments(arguments);
            
            global.setTimeout(function () {
                tasks.runIfPresent(handle);
            }, 0);

            return handle;
        };
    }

    if (!global.setImmediate) {
        // If supported, we should attach to the prototype of global, since that is where setTimeout et al. live.
        var attachTo = typeof Object.getPrototypeOf === "function" && "setTimeout" in Object.getPrototypeOf(global) ?
                          Object.getPrototypeOf(global)
                        : global;

        if (hasMicrosoftImplementation()) {
            // For IE10
            aliasMicrosoftImplementation(attachTo);
        } else {
            if (canUseMessageChannel()) {
                // For super-modern browsers; also works inside web workers.
                installMessageChannelImplementation(attachTo);
            } else if (canUsePostMessage()) {
                // For modern browsers.
                installPostMessageImplementation(attachTo);
            } else {
                // For older browsers.
                installSetTimeoutImplementation(attachTo);
            }

            attachTo.clearImmediate = tasks.remove;
        }
    }
}(this));
