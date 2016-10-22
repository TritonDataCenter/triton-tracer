//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var cls = require('continuation-local-storage');

var TritonConstants = require('./ot-constants');
var TritonTracerImp = require('./ot-tracer-imp');

var _global = require('../global');

var MICROS_PER_MS = 1000;
var MICROS_PER_SECOND = 1000000;
var NS_PER_MICROS = 1000;

function extractTimers(req) {
    var idx;
    var reqTimers = (req.timers || []);
    var _t;
    var t;
    var timer;
    var timers = {};

    // Same basic logic as restify/lib/plugins/audit.js, except times
    // will be in milliseconds. NOTE: we also name the timers:
    //
    //  IDX.name
    //
    // here where IDX is their order in the array so that the ordering
    // is kept even though we'll have an object instead of an array.
    for (idx = 0; idx < reqTimers.length; idx++) {
        timer = req.timers[idx];
        t = timer.time;
        _t = Math.floor((MICROS_PER_SECOND * t[0])
            + (t[1] / NS_PER_MICROS)) / MICROS_PER_MS;

        timers[idx + '.' + timer.name] = _t;
    }

    return (timers);
}

function initRestifyServer(server) {
    assert.object(server, 'server');

    // We do server.use instead of server.on('request', ...) because the
    // 'request' event is emitted before we've got the route.name. Adding
    // as a server.use() allows us to already have that. If there's a request
    // that happens without a handler, it won't go through this path so
    // server.on('after', ... will have to deal with that.
    server.use(function _startReq(req, res, next) {
        // must have a route.name if we are handling this request
        assert.string(req.route.name, 'req.route.name');

        var cls = _global.cls();
        var extractedCtx;
        var fields = {
            startTime: req._time
        };
        var span;
        var spanName = req.route.name;
        var tracer = _global.tracer();

        extractedCtx = tracer.extract(TritonConstants.RESTIFY_REQ_CARRIER, req);
        if (extractedCtx) {
            fields.childOf = extractedCtx;
        }

        // start/join a span
        span = tracer.startSpan(spanName, fields);
        span.addTags({
            component: 'restify',
            'http.method': req.method,
            'http.url': req.url,
            'peer.addr': req.connection.remoteAddress,
            'peer.port': req.connection.remotePort
        });
        span.log({event: 'server-request', timestamp: req._time});

        // This should put the tritonTraceSpan span in the ctx for all handlers
        // of this req.
        cls.bindEmitter(req);
        cls.bindEmitter(res);
        cls.run(function _runForReq() {
            req.tritonTraceSpan = span;
            cls.set('tritonTraceSpan', span);
            next();
        });
    });

    // After a request we want to log the response and finish the span.
    server.on('after', function _endReq(req, res, route, err) {
        var fields = {
            startTime: req._time
        };
        var span = req.tritonTraceSpan;
        var tracer = _global.tracer();

        // XXX figure out how to handle this error.
        //
        // Example (docker rm nonexistent):
        //
        // Uncaught DockerError: No such container: a02f1f40dac9; caused by ResourceNotFoundError: container "a02f1f40dac9" not found
        //
        // FROM
        // Function.assert.ifError (assert.js:326:50)
        // Server._endReq (/opt/smartdc/docker/node_modules/triton-tracer/lib/restify-server.js:108:16)
        //
        // Probably: continue to create a new span but mark it as an error span?
        // Set status code to 500 if we don't have anything else to go on? And
        // add tag with error message?
        //
        // For now, we just ignore this trace.
        if (err) {
            return;
        }

        if (!span) {
            // if we don't have a span, that's most likely because we got a
            // request for which we don't have a handler (since that won't hit
            // server.use()). So in that case, we'll just create a new span for
            //  this request anyway since we did have to process it even if we
            //  didn't call any handlers.
            fields.startTime
            span = tracer.startSpan('http_request', fields);
            span.addTags({
                component: 'restify',
                'http.method': req.method,
                'http.url': req.url,
                'peer.addr': req.connection.remoteAddress,
                'peer.port': req.connection.remotePort
            });
            span.log({event: 'server-request', timestamp: req._time});
        }

        // now we add the bits that are available from after the request has
        // been handled.
        span.addTags({
            'http.status_code': res.statusCode,
            'restify.timers': extractTimers(req)
        });
        span.log({event: 'server-response'});
        span.finish();
    });
}

module.exports = {
    init: initRestifyServer
};
