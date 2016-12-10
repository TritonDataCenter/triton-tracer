//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var localSpan = require('./lib/local-span.js');
var restifyClients = require('./lib/restify-clients.js');
var restifyServer = require('./lib/restify-server.js');
var TritonTracerConstants = require('./lib/ot-constants.js');
var TritonTracerOpenTracer = require('./lib/ot-tracer-imp.js');

var _global = require('./global');

function getTracer() {
    return (_global.tracer());
}

function getCLS() {
    return (_global.cls());
}

function getCurrentSpan() {
    var cls = _global.cls();
    var span;

    if (cls) {
        span = cls.get(TritonTracerConstants.CLS_SPAN_KEY);
    }

    return (span);
}

function setCurrentSpan(span) {
    var cls = _global.cls();

    assert.object(cls, 'cls');
    cls.set(TritonTracerConstants.CLS_SPAN_KEY, span);
}

//
// This is a first attempt at something to help track down where spans are being
// lost. If you add:
//
//  next = findLoser('myModule', next);
//
// to the beginning of a function that should call next, it will help you
// determine if your function is the one losing the context trail (usually due
// to an event emitter).
//
function findLoser(moduleName, next) {
    var caller = moduleName + '.' + arguments.callee.caller.name;
    var hadSpan = false;
    var span = getCurrentSpan();

    if (span) {
        console.error('XXX span at ' + caller + ': '
            + JSON.stringify(span._context));
        hadSpan = true;
    } else {
        console.error('XXX no span at ' + caller);
    }

    return function _findLoserNext() {
        var _span = getCurrentSpan();
        var self = this;

        if (_span) {
            console.error('XXX still have span at ' + caller + ' callback: '
                + JSON.stringify(_span.context()));
        } else if (hadSpan) {
            console.error('XXX span lost in ' + caller);
        } else {
            console.error('XXX still no span at ' + caller + ' callback');
        }

        next.apply(self, arguments);
    };
}

module.exports = {
    // debugging
    _findLoser: findLoser,

    // getters/setters
    cls: getCLS,
    consts: TritonTracerConstants,
    getCurrentSpan: getCurrentSpan,
    setCurrentSpan: setCurrentSpan,
    tracer: getTracer,

    // helpers
    localSpan: localSpan.createLocalSpan,

    // initialize the tracer
    init: _global.init,

    // instrumenters
    instrumentRestifyServer: restifyServer.instrumentRestifyServer,

    // in case someone just wants the tracer imp
    opentracer: TritonTracerOpenTracer,

    // wrappers
    wrapRestifyClients: restifyClients.wrapRestifyClients
};
