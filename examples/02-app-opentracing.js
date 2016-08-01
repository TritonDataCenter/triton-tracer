//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

//
// This example app has 1 endpoint '/hello/:number' and is designed to show the
// tracing functionality by recursively calling itself. Example output:
//
//    # curl http://0.0.0.0:8080/hello/2
//    hello from level 2
//    hello from level 1
//    hello from level 0
//    #
//
// in this case we called with "number" 2 so in response to the initial /hello/2
// request, the restify server called itself with /hello/1 which in turn called
// itself with /hello/0.
//
// In the versions that support tracing, you should see that:
//
//  * The request-id/trace-id is the same for all requests involved with
//    responding to a single top-level (e.g. curl here) call.
//
//  * Each set of client-request, server-request, server-response and
//    client-response should share a span_id that separates this span from
//    others.
//
// The intention is to show what additions are required for a restify
// server/client setup in order to support tracing using the triton-tracer
// module.
//
// To run one of these example files, use:
//
//    # node examples/<filename> 2>&1 | bunyan
//
// so you can see the bunyan-formatted output.
//

var url = require('url');

var assert = require('assert-plus');
var bunyan = require('bunyan');
var restify = require('restify');
var restifyClients = require('restify-clients');
var opentracing = require('opentracing');
var tritonTracer = require('../index'); // usually you'd use 'triton-tracer'

var APP_NAME = 'ExampleServer';
var APP_PORT = 8080;
var MICROS_PER_SECOND = 1000000;
var NS_PER_MICROS = 1000;

// Logs to stderr.
var bunyanLogger = bunyan.createLogger({name: APP_NAME});
var server;

// We use this client for talking to ourself.
var selfClient = restifyClients.createStringClient({
    agent: false,
    log: bunyanLogger,
    url: 'http://0.0.0.0:' + APP_PORT.toString(),
    version: '*'
});

function respond(req, res, next) {
    var client;
    var level;
    var query;
    var span;
    var spanCtx;

    assert.object(req, 'req');
    assert.object(req.params, 'req.params');
    assert.string(req.params.level, 'req.params.level');
    assert.object(req.tritonTraceSpan, 'req.tritonTraceSpan');

    level = Number(req.params.level);
    spanCtx = req.tritonTraceSpan.context();

    function _respond(extra) {
        var prev = (extra ? extra : '');

        res.charSet('utf-8');
        res.contentType = 'text/plain';
        res.send('hello from level ' + level.toString() + '\r\n' + prev);
        next();
    }

    if (level <= 0) {
        _respond();
        return;
    }

    query = url.format({pathname: '/hello/' + (level - 1).toString()});

    // create a traced version of the client with our span
    client = selfClient.child({
        before: function _addHeaders(opts) {
            // outbound request means a new span
            span = opentracing.startSpan('client_request', {childOf: spanCtx});
            // Add headers to our outbound request
            opentracing.inject(span.context(), opentracing.FORMAT_TEXT_MAP,
                opts.headers);
            span.log({event: 'client-request'});
        }, after: function _onResponse(/* r_err, r_req, r_res */) {
            // TODO: handle err
            span.log({event: 'client-response'});
            span.finish();
        }
    });
    client.get(query, function _getResponse(err, c_req, c_res, body) {
        // TODO handle err
        assert.ifError(err);
        _respond(body);
        next();
    });
}

server = restify.createServer({
    log: bunyanLogger,
    name: APP_NAME
});

// Start the tracing backend.
opentracing.initGlobalTracer(new tritonTracer.opentracer({
    logger: bunyanLogger
}));

// We do server.use instead of server.on('request', ...) because the 'request'
// event is emitted before we've got the route.name.
server.use(function startTracing(req, res, next) {
    var extractedCtx;
    var fields = {};
    var restifyCarrier = tritonTracer.consts.RESTIFY_REQ_CARRIER;
    var span;
    var spanName = (req.route ? req.route.name : 'http_request');

    extractedCtx = opentracing.extract(restifyCarrier, req);
    if (extractedCtx) {
        // fields.childOf = extractedCtx;
        fields.continuationOf = extractedCtx;
    }

    // start/join a span
    span = opentracing.startSpan(spanName, fields);
    span.addTags({
        'http.method': req.method,
        'http.url': req.url
    });
    span.log({event: 'server-request'});

    // attach the span to the req object so we can use it elsewhere.
    req.tritonTraceSpan = span;

    next();
});

// This sets up to add req.log to all req objects
server.use(restify.requestLogger());

// After a request we want to log the response and finish the span.
server.on('after', function _afterReq(req, res, route, err) {
    var span;
    var timers = {};

    // TODO: handle err
    assert.ifError(err);

    if (req.hasOwnProperty('tritonTraceSpan')) {
        span = req.tritonTraceSpan;

        // Same logic as restify/lib/plugins/audit.js, times will be in
        // microseconds.
        (req.timers || []).forEach(function _eachTimer(time) {
            var t = time.time;
            var _t = Math.floor((MICROS_PER_SECOND * t[0])
                + (t[1] / NS_PER_MICROS));

            timers[time.name] = _t;
        });

        span.addTags({
            'http.status_code': res.statusCode,
            'restify.timers': timers
        });
        span.log({event: 'server-response'});
        span.finish();
    }
});

// This sets up to output regular bunyan logs for every request.
server.on('after', function _auditAfter(req, res, route, err) {
    var auditLogger = restify.auditLogger({
        log: req.log.child({route: route && route.name}, true)
    });

    auditLogger(req, res, route, err);
});

server.get({
    name: 'GetHello',
    path: '/hello/:level'
}, respond);

server.listen(APP_PORT, function _onListen() {
    console.log('%s listening at %s', server.name, server.url);
});
