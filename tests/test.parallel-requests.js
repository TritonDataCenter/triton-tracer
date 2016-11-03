//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
/* eslint-disable no-magic-numbers, no-console */

var assert = require('assert-plus');
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
// This test creates two servers and sends 20 requests in parallel to the first
// server (serverA) which are proxied through to the second server (serverB).
// Each of these requests is passed a unique, known request-id (traceId) so that
// we can confirm that the spans were all correctly dealt with.
//
// The goal here is to ensure that the spanIds and traceIds don't somehow get
// tangled up when we're making a bunch of requests.
//
test('test w/ parallel requests', function _testParallelRequests(t) {
    var emitter = new EventEmitter();
    var requests = {};
    var seenSpans = {};

    vasync.pipeline({
        arg: {
            clientResults: [],
            results: {}
        }, funcs: [
            function startServerA(_, cb) {
                h.startServer(t, emitter, 'serverA', SERVERA_PORT, clients, cb);
            }, function startServerB(_, cb) {
                h.startServer(t, emitter, 'serverB', SERVERB_PORT, clients, cb);
            }, function makeParallelRequests(state, cb) {
                var idx;

                for (idx = 0; idx < 20; idx++) {
                    requests[uuid.v4()] = {};
                }

                t.comment('making parallel requests');
                vasync.forEachParallel({
                    func: function _makeRequest(traceId, _cb) {
                        clients.serverA.unwrapped.get({
                            headers: {
                                connection: 'close',
                                'request-id': traceId
                            },
                            path: '/proxy/' + SERVERB_PORT + '/delayeddebug'
                        }, function _getProxyCb(err, req, res, obj) {
                            t.ifError(err, 'GET serverA:/proxy/<serverB>/'
                                + 'delayeddebug (' + traceId + ')');
                            requests[traceId].body = obj;
                            requests[traceId].headers = res.headers;
                            _cb();
                        });
                    }, inputs: Object.keys(requests)
                }, function _doneAllRequests(err /* , results */) {
                    t.ifError(err, 'completed parallel requests');
                    cb();
                });
            }, function endServerA(state, cb) {
                t.comment('shutting down');
                h.shutdownServer(t, emitter, state, 'serverA', clients, cb);
            }, function endServerB(state, cb) {
                h.shutdownServer(t, emitter, state, 'serverB', clients, cb);
            }, function checkResults(state, cb) {
                var idx;
                var serverAobjs
                    = h.arrayifyStdout(state.results.serverA.stdout);
                var serverBobjs
                    = h.arrayifyStdout(state.results.serverB.stdout);
                var span;

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

                // should be 42 messages:
                //
                //  0: listening
                //  1-40: client + server (proxy) requests
                //  41: goodbye
                t.equal(serverAobjs.length, 42,
                    'serverA output 42 JSON objects (bunyan lines)');
                for (idx = 1; idx < 41; idx++) {
                    span = serverAobjs[idx];

                    // assert.ok() rather than t.ok() because we spew out enough
                    // messages already.
                    assert.string(span.tags.component, 'span.tags.component: '
                        + JSON.stringify(span));
                    assert.string(span.traceId, 'span.traceId: '
                        + JSON.stringify(span));
                    assert.ok(['restifyclient', 'restify']
                        .indexOf(span.tags.component) !== -1,
                        'unexpected component: ' + span.tags.component);

                    if (requests[span.traceId]
                        .hasOwnProperty(span.tags.component)
                        && requests[span.traceId][span.tags.component].A) {
                        // only should have 1 per component per server
                        t.fail('duplicate ' + span.tags.component + '.A for '
                            + span.traceId);
                        console.error('serverA objects:\n'
                            + JSON.stringify(serverAobjs, null, 2));
                    } else {
                        if (!requests[span.traceId][span.tags.component]) {
                            requests[span.traceId][span.tags.component] = {};
                        }
                        requests[span.traceId][span.tags.component].A = span;
                    }
                }

                // first message is not actually a tracing message, just for
                // debugging but we confirm it's what we expected.
                t.equal(serverAobjs[0].msg, 'listening',
                    'first obj for serverA has: msg === "listening"');
                // ends with goodbye
                t.equal(serverAobjs[41].operation, 'goodbye',
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

                // should be 22 messages:
                //
                //  0: listening
                //  1-20: delaydebug server requests
                //  21: goodbye
                t.equal(serverBobjs.length, 22,
                    'serverB output 22 JSON objects (bunyan lines)');
                for (idx = 1; idx < 21; idx++) {
                    span = serverBobjs[idx];

                    // assert.ok() rather than t.ok() because we spew out enough
                    // messages already.
                    assert.string(span.tags.component, 'span.tags.component: '
                        + JSON.stringify(span));
                    assert.string(span.traceId, 'span.traceId: '
                        + JSON.stringify(span));
                    assert.ok(span.tags.component === 'restify',
                        'unexpected component: ' + span.tags.component);

                    if (requests[span.traceId][span.tags.component].B) {
                        t.fail('duplicate ' + span.tags.component + '.B for '
                            + span.traceId);
                        console.error('serverB objects:\n'
                            + JSON.stringify(serverBobjs, null, 2));
                    } else {
                        requests[span.traceId][span.tags.component].B = span;
                    }
                }

                // first message is not actually a tracing message, just for
                // debugging but we confirm it's what we expected.
                t.equal(serverBobjs[0].msg, 'listening',
                    'first obj for serverB has: msg === "listening"');
                // ends with goodbye
                t.equal(serverBobjs[21].operation, 'goodbye',
                    'serverB logged goodbye');

                // Step 3: Validate all the logs to ensure that:
                //
                //  * each spanId was only used once
                //  * each trace has complete chain of parentSpanId -> spanId
                //  * all traces were completed

                t.comment('validating results');

                if (process.env.TRITON_TRACER_DEBUG) {
                    console.error(JSON.stringify(requests, null, 2));
                }

                Object.keys(requests).forEach(function _checkReq(req) {
                    var traceId = req;

                    // ensure we've got all sections

                    if (!requests[traceId].restify) {
                        t.fail(traceId + ' is missing "restify" section');
                        return;
                    }

                    if (!requests[traceId].restifyclient) {
                        t.fail(traceId + ' is missing "restifyclient" section');
                        return;
                    }

                    if (!requests[traceId].restify.A) {
                        t.fail(traceId + ' is missing "restify.A" section');
                        return;
                    }

                    if (!requests[traceId].restifyclient.A) {
                        t.fail(traceId
                            + ' is missing "restifyclient.A" section');
                        return;
                    }

                    if (!requests[traceId].restify.B) {
                        t.fail(traceId + ' is missing "restify.B" section');
                        return;
                    }

                    // check that these are all part of the same trace

                    if (requests[traceId].restifyclient.A.traceId !== traceId
                        || requests[traceId].restify.A.traceId !== traceId
                        || requests[traceId].restify.B.traceId !== traceId) {
                        // all these components should be part of this trace
                        t.fail(traceId + ' component has bad traceId: '
                            + JSON.stringify(requests[traceId]));
                        return;
                    }

                    // check for reused spanId

                    if (seenSpans[requests[traceId].restifyclient.A.spanId]) {
                        t.fail(traceId
                            + ' restifyclient.A span was already used');
                        console.error(JSON.stringify(requests));
                        return;
                    }
                    seenSpans[requests[traceId].restifyclient.A.spanId] = true;

                    if (seenSpans[requests[traceId].restify.A.spanId]) {
                        t.fail(traceId + ' restify.A span was already used');
                        console.error(JSON.stringify(requests));
                        return;
                    }
                    seenSpans[requests[traceId].restify.A.spanId] = true;

                    if (seenSpans[requests[traceId].restify.B.spanId]) {
                        t.fail(traceId + ' restify.B span was already used');
                        console.error(JSON.stringify(requests));
                        return;
                    }
                    seenSpans[requests[traceId].restify.B.spanId] = true;

                    // check proper parentage

                    if (requests[traceId].restify.B.parentSpanId
                        !== requests[traceId].restifyclient.A.spanId) {
                        // bad parenting!
                        t.fail(traceId + ' expect restify.B.parentSpanId to be '
                            + 'restifyclient.A.spanId');
                        console.error(JSON.stringify(requests[traceId]));
                        return;
                    }

                    if (requests[traceId].restifyclient.A.parentSpanId
                        !== requests[traceId].restify.A.spanId) {
                        // bad parenting!
                        t.fail(traceId + ' expect restifyclient.A.parentSpanId '
                            + 'to be restify.A.spanId');
                        console.error(JSON.stringify(requests[traceId]));
                        return;
                    }

                    if (requests[traceId].restify.A.parentSpanId !== '0') {
                        // bad parenting!
                        t.fail(traceId
                            + ' expect restify.A.parentSpanId to be "0"');
                        console.error(JSON.stringify(requests[traceId]));
                        return;
                    }

                    t.pass('all components of trace ' + traceId + ' seem ok');
                });

                cb();
            }
        ]
    }, function _pipelineComplete(err /* , results */) {
        t.comment('cleanup');
        t.ifError(err, 'completed requests through servers A and B');
        t.end();
    });
});
