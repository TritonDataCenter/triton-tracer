//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

var sampler = require('./sampler');
var TritonConstants = require('./ot-constants');

var _global = require('../global');

var MICROS_PER_MS = 1000;
var MICROS_PER_SECOND = 1000000;
var NS_PER_MICROS = 1000;

function zeroPad(num, width) {
    var strNum = num.toString();

    while (strNum.length < width) {
        strNum = '0' + strNum;
    }

    return (strNum);
}

function extractTimers(req) {
    var digits;
    var idx;
    var reqTimers = (req.timers || []);
    var _t;
    var t;
    var timer;
    var timers = {};

    // Figure out how many digits in the longest timer index so we can pad the
    // shorter ones.
    digits = (reqTimers.length ? reqTimers.length - 1 : 0).toString().length;

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

        timers[zeroPad(idx, digits) + '.' + timer.name] = _t;
    }

    return (timers);
}

function instrumentRestifyServer(options) {
    var server;
    var ignoreRoutes;

    assert.object(options, 'options');
    assert.object(options.server, 'options.server');
    assert.optionalArrayOfString(options.ignoreRoutes, 'options.ignoreRoutes');

    server = options.server;
    ignoreRoutes = options.ignoreRoutes;
    if (ignoreRoutes) {
        // Convert the array into a set, for easy lookup.
        ignoreRoutes = new Set(ignoreRoutes);
    }

    // If the tracer has not been initialized yet - initialize it now.
    if (!_global.tracer()) {
        assert.object(server.log, 'server.log');

        server.log.info('Initializing the triton tracer');
        _global.init({log: server.log});
    }

    // We do server.use instead of server.on('request', ...) because the
    // 'request' event is emitted before we've got the route.name. Adding
    // as a server.use() allows us to already have that. If there's a request
    // that happens without a handler, it won't go through this path so
    // server.on('after', ... will have to deal with that.
    server.use(function _startReq(req, res, next) {
        var cls;
        var extractedCtx;
        var fields;
        var filter;
        var span;
        var tracer;

        // must have a route.name if we are handling this request
        assert.object(req.route, 'req.route');
        assert.string(req.route.name, 'req.route.name');

        if (ignoreRoutes && ignoreRoutes.has(req.route.name)) {
            req.tritonTracingIgnoreRoute = true;
            next();
            return;
        }

        fields = {
            startTime: req._time
        };
        tracer = _global.tracer();

        extractedCtx = tracer.extract(TritonConstants.RESTIFY_REQ_CARRIER, req);
        if (extractedCtx) {
            fields.childOf = extractedCtx;
        }

        // We only do sampling if we've got no parent, or if we're the first
        // span and the parent didn't indicate whether tracing was enabled or
        // not. Also, only if there's actually a sampling filter defined.
        if ((!extractedCtx || (extractedCtx._spanId === '0'
            && extractedCtx._traceEnabled === undefined))
            && tracer.sampling) {
            // New span, so we need to figure out if tracing should be enabled.
            filter = {
                route: req.route.name
            };
            filter[req.method] = req.url;
            fields.enable = sampler.shouldEnable(filter, tracer.sampling);
        }

        // start/join a span
        span = tracer.startSpan(req.route.name, fields);
        span.addTags({
            component: 'restify',
            'http.method': req.method,
            'http.url': req.url,
            'peer.addr': req.connection.remoteAddress,
            'peer.port': req.connection.remotePort
        });

        // Timestamp will be the req._time rather than now, since that's set
        // when the request is actually started, vs. when we're called.
        span.log({event: 'server-request', timestamp: req._time});

        // always make sure responses include request-id header
        res.setHeader('request-id', span._context._traceId);

        // TODO: determine whether this works and/or is sufficient
        res.removeHeader('x-request-id');

        // This should put the tritonTraceSpan span in the ctx for all handlers
        // of this req. We also put the tritonTraceSpan on the req object so
        // that the server.on('after') handler has access to it since it's not
        // in our continuation chain.
        //
        // TODO: confirm we cannot get the trace from CLS instead in `after`
        cls = _global.cls();
        cls.bindEmitter(req);
        cls.bindEmitter(res);
        cls.run(function _runForReq() {
            req.tritonTraceSpan = span;
            cls.set(TritonConstants.CLS_SPAN_KEY, span);
            next();
        });
    });

    // After a request we want to log the response and finish the span.
    server.on('after', function _endReq(req, res, route, err) {
        var fields;
        var span;
        var tracer;

        if (req.tritonTracingIgnoreRoute === true) {
            return;
        }

        // XXX figure out how to handle this error.
        //
        // Example (docker rm nonexistent):
        //
        // Uncaught DockerError: No such container: a02f1f40dac9; caused by
        //   ResourceNotFoundError: container "a02f1f40dac9" not found
        //
        // FROM
        // Function.assert.ifError (assert.js:326:50)
        // Server._endReq (/opt/smartdc/docker/node_modules/triton-tracer/lib/
        //   restify-server.js:108:16)
        //
        // Probably: continue to create a new span but mark it as an error span?
        // Set status code to 500 if we don't have anything else to go on? And
        // add tag with error message?
        //
        // For now, we just ignore this trace.
        if (err) {
            return;
        }

        span = req.tritonTraceSpan;

        if (!span) {
            // if we don't have a span, that's most likely because we got a
            // request for which we don't have a handler (since that won't hit
            // server.use()). So in that case, we'll just create a new span for
            //  this request anyway since we did have to process it even if we
            //  didn't call any handlers.
            tracer = _global.tracer();
            fields = {
                startTime: req._time
            };
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

//
// After creating a restify server, you can then:
//
//   var tritonTracer = require('triton-tracer');
//   tritonTracer.instrumentRestifyServer({server: server});
//
// to enable tracing.
//
module.exports = {
    // _extractTimers is only exported for tests
    _extractTimers: extractTimers,
    instrumentRestifyServer: instrumentRestifyServer
};
