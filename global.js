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
var cls = require('cls-hooked');
var opentracing = require('opentracing');
var TritonTracerConstants = require('./lib/ot-constants.js');
var TritonTracerOpenTracer = require('./lib/ot-tracer-imp.js');

function init(options) {
    var tritonTracer;

    // This function is only ever intended to be called once per program.
    assert.equal(process.TritonTracer, undefined,
        'init() must only be called once');

    process.TritonCLS
        = cls.createNamespace(TritonTracerConstants.CLS_NAMESPACE);

    // initialize opentracing using the TritonTracer implementation
    tritonTracer = new TritonTracerOpenTracer(options);
    opentracing.initGlobalTracer(tritonTracer);
    process.TritonTracer = opentracing.globalTracer();
    process.TritonTracer.sampling = tritonTracer.sampling;
}

function getTracer() {
    return process.TritonTracer;
}

function getCLS() {
    return process.TritonCLS;
}

module.exports = {
    cls: getCLS,
    init: init,
    tracer: getTracer
};
