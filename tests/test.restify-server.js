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

var SERVERA_PORT = 8081;
var SERVERB_PORT = 8082;

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
    emitter.once(serverName, function _waitServerA(info) {
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

function mkSpanObj(spans, server, reqIdx, type) {
    return {
        // e.g. serverA.req[0].client
        prefix: 'server' + server + '.req[' + reqIdx + '].' + type,
        // e.g. spans.serverA.req[0].client
        span: spans['server' + server].req[reqIdx][type]
    };
}

function checkValidSpan(t, spanObj) {
    var prefix = spanObj.prefix;
    var span = spanObj.span;

    t.equal(span.TritonTracing, 'TRITON', prefix
        + ' has TritonTracing=TRITON');
    t.ok(plausibleMsTimestamp(span.begin), prefix
        + ' has a plausible begin timestamp: ' + span.begin);
    t.ok(plausibleMsTimestamp(span.end), prefix
        + ' has a plausible end timestamp: ' + span.end);
    t.equal(span.elapsed, (span.end - span.begin), prefix
        + ' elapsed matches (end - begin): ' + span.elapsed);
    t.ok(span.traceId, prefix + ' has traceId: ' + span.traceId);
    t.ok(span.spanId, prefix + ' has spanId: ' + span.spanId);
    t.ok(span.parentSpanId, prefix + ' has parentSpanId: '
        + span.parentSpanId);
}

function checkSpanProp(t, spanObj, propName, expectedValue) {
    var prefix = spanObj.prefix;
    var span = spanObj.span;

    t.equal(span[propName], expectedValue, prefix + ' has .' + propName
        + ' === ' + span[propName]);
}

function checkSpanTag(t, spanObj, tagName, expectedValue) {
    var prefix = spanObj.prefix;
    var span = spanObj.span;

    t.equal(span.tags[tagName], expectedValue, prefix + ' has .tags[' + tagName
        + '] === ' + span.tags[tagName]);
}

//
// Overview:
//
//  This test creates two servers (serverA and serverB) then:
//
//   req0: we call GET /proxy/<serverB>/hello on serverA, which:
//       * calls /hello on serverB
//       * returns the result of ^^ to client (this test)
//   req1: we call GET /trickyproxy/<serverB>/hello on serverA, which does the
//         same thing as req1 but does some trickery on the server side to try
//         to fool the CLS implementation.
//
// After these two requests, we call POST /goodbye on each of serverA and
// serverB in turn and wait for them to shut themselves down.
//
// Once both servers have been shutdown we do a bunch of checks to ensure that
// the logs generated by serverA and serverB during our tests match what we'd
// expect given that they're instrumented with our tracing.
//
// You'll see:
//
//  serverA.req[0].client -- the client span for req0 when A calls B
//  serverA.req[0].server -- the server span for req0 in A
//  serverA.req[1].client -- the client span for req1 when A calls B
//  serverA.req[1].server -- the server span for req1 in A
//  serverB.req[0].server -- the server span for req0 in B
//  serverB.req[1].server -- the server span for req1 in B
//
test('trace and span ids passed through client to server',
function _testSingleRequest(t) {
    var emitter = new EventEmitter();

    vasync.pipeline({
        arg: {
            clientResults: [],
            results: {}
        }, funcs: [
            function startServerA(_, cb) {
                startServer(t, emitter, 'serverA', SERVERA_PORT, cb);
            }, function startServerB(_, cb) {
                startServer(t, emitter, 'serverB', SERVERB_PORT, cb);
            }, function proxyOneToTwo(state, cb) {
                clients.serverA.get({
                    headers: {connection: 'close'},
                    path: '/proxy/' + SERVERB_PORT + '/hello'
                }, function _getProxyCb(err, req, res, obj) {
                    t.ifError(err, 'GET serverA:/proxy/<serverB>/hello');
                    state.clientResults.push({
                        body: obj,
                        headers: res.headers
                    });
                    cb();
                });
            }, function trickyProxyOneToTwo(state, cb) {
                clients.serverA.get({
                    headers: {connection: 'close'},
                    path: '/trickyproxy/' + SERVERB_PORT + '/hello'
                }, function _getProxyCb(err, req, res, obj) {
                    t.ifError(err, 'GET serverA:/trickyproxy/<serverB>/hello');
                    state.clientResults.push({
                        body: obj,
                        headers: res.headers
                    });
                    cb();
                });
            }, function endServerA(state, cb) {
                shutdownServer(t, emitter, state, 'serverA', cb);
            }, function endServerB(state, cb) {
                shutdownServer(t, emitter, state, 'serverB', cb);
            }, function checkResults(state, cb) {
                var serverAobjs = arrayifyStdout(state.results.serverA.stdout);
                var serverBobjs = arrayifyStdout(state.results.serverB.stdout);
                var span;
                var spans = {
                    serverA: {
                        req: []
                    }, serverB: {
                        req: []
                    }
                };

                // Step 1: Validate the data we got back from serverA
                t.comment('validate serverA data');
                t.equal(state.results.serverA.error, null,
                    'no error from serverA');
                t.equal(state.results.serverA.signal, null,
                    'no signal from serverA');
                t.equal(state.results.serverA.stderr, '',
                    'no stderr from serverA');
                t.equal(state.results.serverA.status, 0,
                    'serverA exited successfully');

                // should be 6 messages:
                //
                //  0: listening
                //  1,2: client + server for first request (proxy)
                //  3,4: client + server for second request (trickyproxy)
                //  5: goodbye
                t.equal(serverAobjs.length, 6,
                    'serverA output 6 JSON objects (bunyan lines)');
                spans.serverA.listening = serverAobjs[0];
                // req[0]
                spans.serverA.req.push({
                    client: serverAobjs[1],
                    server: serverAobjs[2]
                });
                // req[1]
                spans.serverA.req.push({
                    client: serverAobjs[3],
                    server: serverAobjs[4]
                });
                spans.serverA.goodbye = serverAobjs[5];

                // first message is not actually a tracing message, just for
                // debugging but we confirm it's what we expected.
                t.equal(spans.serverA.listening.msg, 'listening',
                    'first obj for serverA has: msg === "listening"');

                // second message is our outbound client request to serverB
                span = mkSpanObj(spans, 'A', 0, 'client');
                t.comment('validate ' + span.prefix);
                checkValidSpan(t, span);
                checkSpanProp(t, span, 'operation', 'restify_request');
                checkSpanTag(t, span, 'component', 'restifyclient');
                checkSpanTag(t, span, 'http.host', '127.0.0.1:' + SERVERB_PORT);
                checkSpanTag(t, span, 'http.method', 'GET');
                checkSpanTag(t, span, 'http.url', '/hello');
                checkSpanTag(t, span, 'span.kind', 'request');

                // third message is our server handler's span
                span = mkSpanObj(spans, 'A', 0, 'server');
                t.comment('validate ' + span.prefix);
                checkValidSpan(t, span);
                checkSpanProp(t, span, 'operation', 'proxyget');
                checkSpanTag(t, span, 'component', 'restify');

                // forth message should be client request #2 (trickyproxy)
                span = mkSpanObj(spans, 'A', 1, 'client');
                t.comment('validate ' + span.prefix);
                checkValidSpan(t, span);
                checkSpanProp(t, span, 'operation', 'restify_request');
                checkSpanTag(t, span, 'component', 'restifyclient');
                checkSpanTag(t, span, 'http.host', '127.0.0.1:' + SERVERB_PORT);
                checkSpanTag(t, span, 'http.method', 'GET');
                checkSpanTag(t, span, 'http.url', '/hello');
                checkSpanTag(t, span, 'span.kind', 'request');

                // fifth message is our server handler's span (2nd request)
                span = mkSpanObj(spans, 'A', 1, 'server');
                t.comment('validate ' + span.prefix);
                checkValidSpan(t, span);
                checkSpanProp(t, span, 'operation', 'trickyproxyget');
                checkSpanTag(t, span, 'component', 'restify');

                // last (6th) message is goodbye!
                t.equal(spans.serverA.goodbye.operation, 'goodbye',
                    'serverA logged goodbye');

                // Step 2: Validate the data we got back from serverB

                t.comment('validate serverB data');
                t.equal(state.results.serverB.error, null,
                    'no error from serverB');
                t.equal(state.results.serverB.signal, null,
                    'no signal from serverB');
                t.equal(state.results.serverB.stderr, '',
                    'no stderr from serverB');
                t.equal(state.results.serverB.status, 0,
                    'serverB exited successfully');

                // should be 4 messages:
                //
                //  0: listening
                //  1: server span for first request (from A)
                //  2: server span for second request (from A)
                //  3: goodbye
                t.equal(serverBobjs.length, 4,
                    'serverB output 4 JSON objects (bunyan lines)');
                spans.serverB.listening = serverBobjs[0];
                // req[0]
                spans.serverB.req.push({
                    server: serverBobjs[1]
                });
                // req[1]
                spans.serverB.req.push({
                    server: serverBobjs[2]
                });
                spans.serverB.goodbye = serverBobjs[3];

                // first message is not actually a tracing message, just for
                // debugging but we confirm it's what we expected.
                t.equal(spans.serverB.listening.msg, 'listening',
                    'first obj for serverB has: msg === "listening"');

                // second message is our server handler's span
                span = mkSpanObj(spans, 'B', 0, 'server');
                t.comment('validate ' + span.prefix);
                checkValidSpan(t, span);
                checkSpanProp(t, span, 'operation', 'hello');
                checkSpanTag(t, span, 'component', 'restify');

                // third message is our server handler's span (req 1)
                span = mkSpanObj(spans, 'B', 1, 'server');
                t.comment('validate ' + span.prefix);
                checkValidSpan(t, span);
                checkSpanProp(t, span, 'operation', 'hello');
                checkSpanTag(t, span, 'component', 'restify');

                // last (4th) message is goodbye!
                t.equal(spans.serverB.goodbye.operation, 'goodbye',
                    'serverA logged goodbye');

                // Step 3: Validate that data was passed around correctly now
                //         that we've loosely verified that the messages are the
                //         ones we'd expect.

                // request 0
                t.comment('check message passing (req 0)');
                t.equal(spans.serverA.req[0].client.traceId,
                    spans.serverA.req[0].server.traceId,
                    'serverA client and server traceIds match (req 0)');
                t.equal(spans.serverA.req[0].client.traceId,
                    spans.serverB.req[0].server.traceId,
                    'serverA client and serverB traceIds match (req 0)');
                t.equal(state.clientResults[0].headers['request-id'],
                    spans.serverA.req[0].server.traceId,
                    'serverA returned correct "request-id" header (req 0)');
                t.deepEqual(state.clientResults[0].body, {reply: 'hello'},
                    'serverA returned expected body (req 0)');
                t.equal(spans.serverA.req[0].client.parentSpanId,
                    spans.serverA.req[0].server.spanId,
                    'serverA client\'s parent should be serverA server span '
                    + '(req 0)');
                t.equal(spans.serverB.req[0].server.parentSpanId,
                    spans.serverA.req[0].client.spanId,
                    'serverB parent should be serverA client span (req 0)');
                t.notEqual(spans.serverA.req[0].client.spanId,
                    spans.serverA.req[0].server.spanId,
                    'serverA client and server should have different spanIds '
                    + '(req 0)');
                t.notEqual(spans.serverA.req[0].client.spanId,
                    spans.serverB.req[0].spanId,
                    'serverA client and serverB should have different spanIds '
                    + '(req 0)');

                // request 1
                t.comment('check message passing (req 1)');
                t.equal(spans.serverA.req[1].client.traceId,
                    spans.serverA.req[1].server.traceId,
                    'serverA client and server traceIds match (req 1)');
                t.equal(spans.serverA.req[1].client.traceId,
                    spans.serverB.req[1].server.traceId,
                    'serverA client and serverB traceIds match (req 1)');
                t.equal(state.clientResults[1].headers['request-id'],
                    spans.serverA.req[1].server.traceId,
                    'serverA returned correct "request-id" header (req 1)');
                t.deepEqual(state.clientResults[1].body, {reply: 'hello'},
                    'serverA returned expected body (req 1)');
                t.equal(spans.serverA.req[1].client.parentSpanId,
                    spans.serverA.req[1].server.spanId,
                    'serverA client\'s parent should be serverA server span '
                    + '(req 1)');
                t.equal(spans.serverB.req[1].server.parentSpanId,
                    spans.serverA.req[1].client.spanId,
                    'serverB parent should be serverA client span (req 1)');
                t.notEqual(spans.serverA.req[1].client.spanId,
                    spans.serverA.req[1].server.spanId,
                    'serverA client and server should have different spanIds '
                    + '(req 1)');
                t.notEqual(spans.serverA.req[1].client.spanId,
                    spans.serverB.req[1].server.spanId,
                    'serverA client and serverB should have different spanIds '
                    + '(req 1)');

                // Now make sure there wasn't span/trace leakage between req 0
                // and req 1. This could happen if CLS for example was broken.
                // NOTE: we only check the server side because we confirm above
                // that client values match server.
                t.comment('checking for leakage between req 0 and req 1');
                spans.serverB.req.forEach(function _checkReqB(bReq, bIdx) {
                    spans.serverA.req.forEach(function _checkReqA(aReq, aIdx) {
                        t.notEqual(bReq.server.spanId, aReq.server.spanId,
                            'serverA.req[' + aIdx + '].server and serverB.req['
                            + bIdx + '] should have different spanIds');
                    });
                });
                t.notEqual(spans.serverB.req[0].server.traceId,
                    spans.serverA.req[1].server.traceId,
                    'traceId between server A and B are different req 0/req 1');

                cb();
            }
        ]
    }, function _pipelineComplete(err /* , results */) {
        t.comment('cleanup');
        t.ifError(err, 'completed requests through servers A and B');
        t.end();
    });
});
