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

var APP_NAME = 'ExampleServer';
var APP_PORT = 8080;

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
        _respond();
        return;
    }

    query = url.format({pathname: '/hello/' + (level - 1).toString()});

    // Make our request.
    selfClient.get(query, function _getResponse(err, c_req, c_res, body) {
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

// This sets up to add req.log to all req objects
server.use(restify.requestLogger());

// This sets up to output regular bunyan logs for every request.
server.on('after', function _auditAfter(req, res, route, err) {
    var auditLogger = restify.auditLogger({
        log: req.log.child({route: route && route.name}, true)
    });

    auditLogger(req, res, route, err);
});

server.get('/hello/:level', respond);

server.listen(APP_PORT, function _onListen() {
    console.log('%s listening at %s', server.name, server.url);
});
