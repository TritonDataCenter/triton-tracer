//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
// This module houses the "global" state for the tracer. When you call
//
// tritonTracer.init()
//
// That calls init() here and sets up the module-local variables here. Other
// components can then call tritonTracer.tracer() and tritonTracer.cls() when
// they need to retrieve the tracer or CLS namespace.
//

var assert = require('assert-plus');
try {
    // cls-hooked requires *way* fewer monkey patches, but only works on node
    // v4.5+, so we try that (it's an optionalDependency) first and fallback to
    // the completely monkey-patched 'continuation-local-storage' otherwise.
    var cls = require('cls-hooked');
} catch (e) {
    assert.equal(e.code, 'MODULE_NOT_FOUND');
    var cls = require('continuation-local-storage');
}
var opentracing = require('opentracing');
var TritonTracerConstants = require('./lib/ot-constants.js');
var TritonTracerOpenTracer = require('./lib/ot-tracer-imp.js');

var initialized = false;
var TritonCLS;
var tracer;

function init(options) {
    // This function is only ever intended to be called once per program.
    assert.equal(initialized, false, 'init() must only be called once');
    initialized = true;

    TritonCLS = cls.createNamespace(TritonTracerConstants.CLS_NAMESPACE);

    // initialize opentracing using the TritonTracer implementation
    opentracing.initGlobalTracer(new TritonTracerOpenTracer(options));
    tracer = opentracing.globalTracer();
}

function getTracer() {
    assert.ok(initialized, 'must call .init() before using tracer');
    return tracer;
}

function getCLS() {
    assert.ok(initialized, 'must call .init() before using cls');
    return TritonCLS;
}

module.exports = {
    cls: getCLS,
    init: init,
    tracer: getTracer
};
