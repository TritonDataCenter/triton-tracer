//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var cls = require('continuation-local-storage');
var Tracer = require('opentracing');

var TritonConstants = require('./ot-constants');
var TritonTracer = require('./ot-tracer-imp');

var MICROS_PER_MS = 1000;
var MICROS_PER_SECOND = 1000000;
var NS_PER_MICROS = 1000;

function initGlobalTracer(options) {
    assert.ok(!Tracer._imp, 'Tracer._imp already defined'); // already init'ed!

    Tracer.initGlobalTracer(new TritonTracer(options));
}

function initRestifyServer(server) {
    assert.object(server, 'server');
    var session = process.tritonTracer.getSession();

    // We do server.use instead of server.on('request', ...) because the
    // 'request' event is emitted before we've got the route.name. Adding
    // as a server.use() allows us to already have that.
    server.use(session.bind(function _startReq(req, res, next) {
        var extractedCtx;
        var fields = {};
        var span;
        var spanName = (req.route ? req.route.name : 'http_request');

        extractedCtx = Tracer.globalTracer()
            .extract(TritonConstants.RESTIFY_REQ_CARRIER, req);
        if (extractedCtx) {
            fields.childOf = extractedCtx;
        }

        // start/join a span
        span = Tracer.globalTracer().startSpan(spanName, fields);
        span.addTags({
            component: 'restify',
            'http.method': req.method,
            'http.url': req.url,
            'peer.addr': req.connection.remoteAddress,
            'peer.port': req.connection.remotePort
        });
        span.log({event: 'server-request'});

        session.set('tritonTraceSpan', span);

        next();
    }));

    // After a request we want to log the response and finish the span.
    server.on('after', session.bind(
        function _endReq(req, res /* , route, err */) {
            var idx;
            var reqTimers = (req.timers || []);
            var span = session.get('tritonTraceSpan');
            var _t;
            var t;
            var timer;
            var timers = {};

            // Should always have added a tritonTraceSpan in the handler above
            assert.object(span, 'session.tritonTraceSpan');

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

            span.addTags({
                'http.status_code': res.statusCode,
                'restify.timers': timers
            });
            span.log({event: 'server-response'});
            span.finish();
        }
    ));
}

function init(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.object(options.restifyServer, 'options.restifyServer');

    initGlobalTracer({log: options.log});
    initRestifyServer(options.restifyServer);
}

function startChildSpan(req, operation) {
    var fields = {};
    var newSpan;

    assert.object(req, 'req');
    assert.string(operation, 'operation');

    fields.childOf = req.tritonTraceSpan.context();

    // start then new child
    newSpan = Tracer.globalTracer().startSpan(operation, fields);

    return (newSpan);
}

function getCurrentSpan() {
    var span = session.get('tritonTraceSpan') || null;

    return (span);
}

module.exports = {
    getCurrentSpan: getCurrentSpan,
    init: init,
    initGlobalTracer: initGlobalTracer,
    initServer: initRestifyServer,
    startChildSpan: startChildSpan,
    Tracer: Tracer
};
