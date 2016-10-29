//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var restifyClients = require('./lib/restify-clients.js');
var restifyServer = require('./lib/restify-server.js');
var TritonTracerConstants = require('./lib/ot-constants.js');

var _global = require('./global');

function getTracer() {
    return (_global.tracer());
}

function getCLS() {
    return (_global.getCLS());
}

module.exports = {
    // getters
    cls: getCLS,
    consts: TritonTracerConstants,
    tracer: getTracer,

    // initialize the tracer
    init: _global.init,

    // instrumenters
    instrumentRestifyServer: restifyServer.instrumentRestifyServer,

    // wrappers
    wrapRestifyClients: restifyClients.wrapRestifyClients
};
