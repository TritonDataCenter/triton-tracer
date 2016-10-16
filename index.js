//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var cls = require('continuation-local-storage');
var opentracing = require('opentracing');
var TritonTracerConstants = require('./lib/ot-constants.js');
var TritonTracerOpenTracer = require('./lib/ot-tracer-imp.js');
var TritonTracerRestifyClient = require('./lib/restify-client.js');
var TritonTracerRestifyServer = require('./lib/restify-server.js');

var alreadyRun = false;

function init(options, callback) {
    // This function is only ever intended to be called once per program.
    // TODO: add test for this.
    assert.equal(alreadyRun, false, 'init() must only be called once');
    alreadyRun = true;

    var session = cls.createNamespace(TritonTracerConstants.CLS_NAMESPACE);
    var Tracer = require('opentracing');

    opentracing.initGlobalTracer(new TritonTracerOpenTracer(options));

    session.run(function _callTracerInitCallback() {
        // XXX
        //
        // This seems kinda unfortunate, but I've not yet thought of a better
        // way for functions elsewhere to find the session.
        //
        process.tritonTracer = {
            getSession: session.bind(function getSession() {
                return (cls.getNamespace(TritonTracerConstants.CLS_NAMESPACE));
            })
        }
        session.set('TritonTracer', opentracing.globalTracer());
        callback(session);
    });
}

module.exports = {
    consts: TritonTracerConstants,
    init: init,
    opentracer: TritonTracerOpenTracer,
    restifyClient: TritonTracerRestifyClient,
    restifyServer: TritonTracerRestifyServer
};
