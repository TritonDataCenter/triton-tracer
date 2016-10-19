//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var cls = require('continuation-local-storage');
var opentracing = require('opentracing');
var TritonTracerConstants = require('./lib/ot-constants.js');
var TritonTracerOpenTracer = require('./lib/ot-tracer-imp.js');
var TritonTracerRestifyClient = require('./lib/restify-client.js');
var TritonTracerRestifyServer = require('./lib/restify-server.js');

var alreadyRun = false;

function init(options) {
    // This function is only ever intended to be called once per program.
    // TODO: add test for this.
    assert.equal(alreadyRun, false, 'init() must only be called once');
    alreadyRun = true;

    process.TritonCLS = cls.createNamespace(TritonTracerConstants.CLS_NAMESPACE);
    var Tracer = require('opentracing');

    process.TritonCLS.run(function () {});
    opentracing.initGlobalTracer(new TritonTracerOpenTracer(options));
    process.TritonCLS.set('TritonTracer', opentracing.globalTracer());
}

module.exports = {
    consts: TritonTracerConstants,
    init: init,
    opentracer: TritonTracerOpenTracer,
    restifyClient: TritonTracerRestifyClient,
    restifyServer: TritonTracerRestifyServer
};
