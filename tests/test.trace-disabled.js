//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
/* eslint-disable no-magic-numbers, no-console */

var EventEmitter = require('events').EventEmitter;
var test = require('tape');
var uuid = require('node-uuid');
var vasync = require('vasync');

var h = require('./helper.common-funcs');

var SERVERA_PORT = 8081;
var SERVERB_PORT = 8082;

var clients = {};

//
// Overview:
//
// This test creates two servers and sends the first a request with tracing
// disabled. It then confirms that no trace messages were logged but that the
// traceId on the remote side (returned by the /debug endpoint) matches which
// means that the request-id header was correctly passed through even though
// tracing was disabled.
//
test('test w/ tracing disabled', function _testTracingDisabled(t) {
    var emitter = new EventEmitter();
    var traceId = uuid.v4();

    vasync.pipeline({
        arg: {
            clientResults: [],
            results: {}
        }, funcs: [
            function startServerA(_, cb) {
                h.startServer(t, emitter, 'serverA', SERVERA_PORT, clients, cb);
            }, function startServerB(_, cb) {
                h.startServer(t, emitter, 'serverB', SERVERB_PORT, clients, cb);
            }, function proxyOneToTwo(state, cb) {
                clients.serverA.unwrapped.get({
                    headers: {
                        connection: 'close',
                        'request-id': traceId,
                        'triton-trace-enable': 'false'
                    },
                    path: '/proxy/' + SERVERB_PORT + '/debug'
                }, function _getProxyCb(err, req, res, obj) {
                    t.ifError(err, 'GET serverA:/proxy/<serverB>/debug');
                    state.clientResults.push({
                        body: obj,
                        headers: res.headers
                    });
                    cb();
                });
            }, function endServerA(state, cb) {
                h.shutdownServer(t, emitter, state, 'serverA', clients, cb);
            }, function endServerB(state, cb) {
                h.shutdownServer(t, emitter, state, 'serverB', clients, cb);
            }, function checkResults(state, cb) {
                var serverAobjs
                    = h.arrayifyStdout(state.results.serverA.stdout);
                var serverBobjs
                    = h.arrayifyStdout(state.results.serverB.stdout);
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

                // should be 2 messages:
                //
                //  0: listening
                //  1: goodbye
                t.equal(serverAobjs.length, 2,
                    'serverA output 2 JSON objects (bunyan lines)');
                spans.serverA.listening = serverAobjs[0];
                spans.serverA.goodbye = serverAobjs[1];

                // first message is not actually a tracing message, just for
                // debugging but we confirm it's what we expected.
                t.equal(spans.serverA.listening.msg, 'listening',
                    'first obj for serverA has: msg === "listening"');
                // ends with goodbye
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

                // should be 2 messages:
                //
                //  0: listening
                //  1: goodbye
                t.equal(serverBobjs.length, 2,
                    'serverB output 2 JSON objects (bunyan lines)');
                spans.serverB.listening = serverBobjs[0];
                spans.serverB.goodbye = serverBobjs[1];

                // first message is not actually a tracing message, just for
                // debugging but we confirm it's what we expected.
                t.equal(spans.serverB.listening.msg, 'listening',
                    'first obj for serverB has: msg === "listening"');
                // ends with goodbye
                t.equal(spans.serverB.goodbye.operation, 'goodbye',
                    'serverB logged goodbye');

                // Step 3: Validate that debug data we got back includes our
                //         traceId since that means both client and server in A
                //         and B had it.

                // request 0
                t.comment('check debug data returned by server B ('
                    + traceId + ')');
                if (process.env.TRITON_TRACER_DEBUG) {
                    console.error(JSON.stringify(state.clientResults[0].body,
                        null, 2));
                }
                t.equal(state.clientResults[0].body.spanCtx._traceEnabled,
                    false, 'tracing should be disabled at server B');
                t.equal(state.clientResults[0].body.spanCtx._traceId,
                    traceId, 'traceId at server B should match ours');
                t.equal(state.clientResults[0].headers['request-id'], traceId,
                    'request-id header from server A should match our traceId');

                cb();
            }
        ]
    }, function _pipelineComplete(err /* , results */) {
        t.comment('cleanup');
        t.ifError(err, 'completed requests through servers A and B');
        t.end();
    });
});
