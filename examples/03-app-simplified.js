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
var Tracer = require('../index'); // usually you'd use 'triton-tracer'

var APP_NAME = 'ExampleServer';
var APP_PORT = 8080;
var RANDOM_WORK = 0.00000001;

// Logs to stderr.
var log = bunyan.createLogger({name: APP_NAME});
var server;

// We use this client for talking to ourself.
var selfClient = restifyClients.createStringClient({
    agent: false,
    log: log,
    url: 'http://0.0.0.0:' + APP_PORT.toString(),
    version: '*'
});

// Does something then returns a number
// Here as an example to show how local processing works in this mode.
function doWork(req, callback) {
    var count = 0;
    var span;

    assert.object(req, 'req');
    assert.object(req.tritonTraceSpan, 'req.tritonTraceSpan');
    assert.func(callback, 'callback');

    // create a child span of the current req's span for our do_work execution
    span = Tracer.restifyServer.startChildSpan(req, 'do_work');
    span.log({event: 'start-work'});

    while (Math.random() > RANDOM_WORK) {
        count++;
    }

    span.addTags({
        'random.loops': count
    });
    span.log({event: 'done-work'});
    span.finish();

    callback(null, count);
}

function respond(req, res, next) {
    var client;
    var level;
    var query;

    assert.object(req, 'req');
    assert.object(req.params, 'req.params');
    assert.string(req.params.level, 'req.params.level');

    level = Number(req.params.level);

    function _respond(extra) {
        var prev = (extra ? extra : '');

        res.charSet('utf-8');
        res.contentType = 'text/plain';
        res.send('hello from level ' + level.toString() + '\r\n' + prev);
        next();
    }

    if (level <= 0) {
        // on the lowest level we do some local processing then respond.
        doWork(req, function _doWork(err, count) {
            assert.ifError(err);
            assert.ok(count > 0, 'should have looped more than once');
            _respond();
        });
        return;
    }

    query = url.format({pathname: '/hello/' + (level - 1).toString()});

    // Get a wrapped client, then make our request.
    client = Tracer.restifyClient.child(selfClient, req);
    client.get(query, function _getResponse(err, c_req, c_res, body) {
        // TODO handle err
        assert.ifError(err);
        _respond(body);
        next();
    });
}

server = restify.createServer({
    log: log,
    name: APP_NAME
});

// Start the tracing backend and instrument this restify 'server'.
Tracer.restifyServer.init({log: log, restifyServer: server});

// This sets up to add req.log to all req objects
server.use(restify.requestLogger());

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
