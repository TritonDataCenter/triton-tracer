//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

var TritonTracerConstants = require('./lib/ot-constants.js');
var TritonTracerRestifyClient = require('./lib/restify-client.js');
var TritonTracerRestifyServer = require('./lib/restify-server.js');

var _global = require('./global');

function init(options) {
    _global.init(options);
}

function getTracer() {
    return (_global.tracer());
}

function getCLS() {
    return (_global.getCLS());
}

module.exports = {
    cls: getCLS,
    consts: TritonTracerConstants,
    init: init,
    restifyClient: TritonTracerRestifyClient,
    restifyServer: TritonTracerRestifyServer,
    tracer: getTracer
};
