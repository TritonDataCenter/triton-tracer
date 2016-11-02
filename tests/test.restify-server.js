//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
/* eslint-disable no-magic-numbers */

var EventEmitter = require('events').EventEmitter;
var forkexec = require('forkexec');
var test = require('tape');
var restify = require('restify');
var restifyClients = require('restify-clients');
var tritonTracer = require('../index');
var vasync = require('vasync');

var SERVER1_PORT = 8081;
var SERVER2_PORT = 8082;

var clients = {};

restifyClients = tritonTracer.wrapRestifyClients({
    restifyClients: restifyClients
});


// start a dummy HTTP server that outputs logs to stdout and emits the results
// when it exits.
function startServer(t, emitter, serverName, serverPort, callback) {
    t.doesNotThrow(function _startServer() {
        forkexec.forkExecWait({
            argv: [process.execPath, __dirname + '/helper.dummy-server.js',
                '--', serverName],
            env: {HTTP_PORT: serverPort}
        }, function _startServerCb(err, info) {
            t.ifError(err, serverName + ' exited w/o error');
            if (!err) {
                emitter.emit(serverName, info);
            }
        });

        // Also create a client for this server
        clients[serverName] = restify.createJsonClient({
            url: 'http://127.0.0.1:' + serverPort
        });
    }, undefined, 'started ' + serverName);

    // server started as child process, now returning.
    callback();
}

function shutdownServer(t, emitter, state, serverName, callback) {
    // setup a watcher for the event that will be emitted when the server
    // actually ends.
    emitter.once(serverName, function _waitServer1(info) {
        t.ok(info, 'saw exit info for ' + serverName);
        state.results[serverName] = info;

        // also remove the client since the server is gone.
        delete clients[serverName];

        callback();
    });

    // Now that we're watching for exit, call the /goodbye endpoint which
    // triggers an exit.
    clients[serverName].post({
        headers: {
            connection: 'close'
        }, path: '/goodbye'
    }, function _postGoodbyeCb(err /* , req, res, obj */) {
        t.ifError(err, 'POST /goodbye to ' + serverName);
    });
}

function arrayifyStdout(stdout) {
    var idx = 0;
    var line;
    var lines = stdout.split(/\n/);
    var result = [];

    for (idx = 0; idx < lines.length; idx++) {
        line = lines[idx].trim();
        if (line.length > 0) {
            result.push(JSON.parse(lines[idx].trim()));
        }
    }

    return (result);
}

function plausibleMsTimestamp(num) {
    // TODO: update before November 20, 2286
    if (num > 1400000000000 && num < 10000000000000) {
        return true;
    }

    return false;
}

function checkValidSpan(t, logMsg, prefix) {
    t.equal(logMsg.TritonTracing, 'TRITON', prefix
        + ' has TritonTracing=TRITON');
    t.ok(plausibleMsTimestamp(logMsg.begin), prefix
        + ' has a plausible begin timestamp: ' + logMsg.begin);
    t.ok(plausibleMsTimestamp(logMsg.end), prefix
        + ' has a plausible end timestamp: ' + logMsg.end);
    t.equal(logMsg.elapsed, (logMsg.end - logMsg.begin), prefix
        + ' elapsed matches (end - begin): ' + logMsg.elapsed);
    t.ok(logMsg.traceId, prefix + ' has traceId: ' + logMsg.traceId);
    t.ok(logMsg.spanId, prefix + ' has spanId: ' + logMsg.spanId);
    t.ok(logMsg.parentSpanId, prefix + ' has parentSpanId: '
        + logMsg.parentSpanId);
}

function checkTag(t, logMsg, tagName, expectedValue, prefix) {
    t.equal(logMsg.tags[tagName], expectedValue, prefix + ' has tags[' + tagName
        + ']=' + logMsg.tags[tagName]);
}

function checkClientTag(t, logMsg, tagName, expectedValue) {
    return checkTag(t, logMsg, tagName, expectedValue, 'client request');
}

test('single request correctly handles span',
function _testSingleRequest(t) {
    var emitter = new EventEmitter();

    vasync.pipeline({
        arg: {results: {}},
        funcs: [
            function startServer1(_, cb) {
                startServer(t, emitter, 'server1', SERVER1_PORT, cb);
            }, function startServer2(_, cb) {
                startServer(t, emitter, 'server2', SERVER2_PORT, cb);
            }, function proxyOneToTwo(state, cb) {
                clients.server1.get({
                    headers: {connection: 'close'},
                    path: '/proxy/' + SERVER2_PORT + '/hello'
                }, function _getProxyCb(err, req, res, obj) {
                    t.ifError(err, 'GET server1:/proxy/<server2>/hello');
                    state.resHeaders = res.headers;
                    state.resBody = obj;
                    cb();
                });
            }, function endServer1(state, cb) {
                shutdownServer(t, emitter, state, 'server1', cb);
            }, function endServer2(state, cb) {
                shutdownServer(t, emitter, state, 'server2', cb);
            }, function checkResults(state, cb) {
                var clientReq;
                var server1 = arrayifyStdout(state.results.server1.stdout);
                var server2 = arrayifyStdout(state.results.server2.stdout);
                var server1Req;
                var server2Req;

                // Step 1: Validate the data we got back from server1

                t.equal(state.results.server1.error, null,
                    'no error from server1');
                t.equal(state.results.server1.signal, null,
                    'no signal from server1');
                t.equal(state.results.server1.stderr, '',
                    'no stderr from server1');
                t.equal(state.results.server1.status, 0,
                    'server1 exited successfully');

                // first message is not a tracing message, just for debugging.
                t.equal(server1[0].msg, 'listening',
                    'first msg for server1 is "listening"');

                // second message is our outbound client request to server2
                clientReq = server1[1];
                checkValidSpan(t, clientReq, 'client request');
                t.equal(clientReq.operation, 'restify_request',
                    'client request has operation=restify_request');
                checkClientTag(t, clientReq, 'component', 'restifyclient');
                checkClientTag(t, clientReq, 'http.host',
                    '127.0.0.1:' + SERVER2_PORT);
                checkClientTag(t, clientReq, 'http.method', 'GET');
                checkClientTag(t, clientReq, 'http.url', '/hello');
                checkClientTag(t, clientReq, 'span.kind', 'request');

                // third message is our server handler's span
                server1Req = server1[2];
                checkValidSpan(t, server1Req, 'server1 request');
                t.equal(server1Req.operation, 'proxyget',
                    'server1 request has operation=proxyget');

                // Step 2: Validate the data we got back from server2

                t.equal(state.results.server2.error, null,
                    'no error from server2');
                t.equal(state.results.server2.signal, null,
                    'no signal from server2');
                t.equal(state.results.server2.stderr, '',
                    'no stderr from server2');
                t.equal(state.results.server2.status, 0,
                    'server2 exited successfully');

                // first message is not a tracing message, just for debugging.
                t.equal(server2[0].msg, 'listening',
                    'first msg for server2 is "listening"');

                // second message is our server handler's span
                server2Req = server2[1];
                checkValidSpan(t, server2Req, 'server2 request');
                t.equal(server2Req.operation, 'hello',
                    'server2 request has operation=hello');

                // Step 3: Validate that data was passed around correctly

                t.equal(clientReq.traceId, server1Req.traceId,
                    'server1 client and server traceIds match');
                t.equal(clientReq.traceId, server2Req.traceId,
                    'server1 client and server2 traceIds match');
                t.equal(state.resHeaders['request-id'], server1Req.traceId,
                    'server1 returned correct "request-id" header');
                t.deepEqual(state.resBody, {reply: 'hello'},
                    'server1 returned expected body');
                t.equal(clientReq.parentSpanId, server1Req.spanId,
                    'server1 client\'s parent should server1 server span');
                t.equal(server2Req.parentSpanId, clientReq.spanId,
                    'server2 parent should be server1 client span');
                t.notEqual(clientReq.spanId, server1Req.spanId,
                    'server1 client and server should have different spanIds');
                t.notEqual(clientReq.spanId, server2Req.spanId,
                    'server1 client and server2 should have different spanIds');

                cb();
            }
        ]
    }, function _pipelineComplete(err /* , results */) {
        t.ifError(err, 'completed single request through servers 1 and 2');
        t.end();
    });
});
