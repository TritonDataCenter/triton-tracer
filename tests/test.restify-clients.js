//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
// Overview:
//
//  This should test that the lib/restify-clients.js wrappers work as expected.
//  It should also force restify-clients to do retries and ensure that works
//  too.
//
/* eslint-disable no-magic-numbers */

var restifyClients = require('restify-clients');
var test = require('tape');
var vasync = require('vasync');

var h = require('./helper.common-funcs');

var logs = [];

h.tritonTracer.init({log: {
    child: function _child() {
        return this;
    }, info: function _info(obj) {
        logs.push(obj);
    }
}});

restifyClients = h.tritonTracer.wrapRestifyClients({
    restifyClients: restifyClients
});

//
// Overview:
//
// This test tests that the wrapped restify-clients do retries and that each
// retry is marked with an 'attempt' tag. Since restify-clients only does
// retries based on connection problems and not on anything we can do after the
// client's sent data (including just closing the socket on them), we need to do
// our retries against a non-existent (we hope) server.
//
test('test restify-client retries', function _testClientRetries(t) {
    var seenSpans = {};

    vasync.pipeline({
        arg: {},
        funcs: [
            function createClient(state, cb) {
                state.client = restifyClients.createJsonClient({
                    // hope you're not running SQL Server!
                    url: 'http://127.0.0.1:' + 156
                });
                cb();
            }, function makeRequest(state, cb) {
                var cls = h.tritonTracer.cls();
                var fields = {
                    startTime: (new Date()).getTime()
                };
                var span;
                var tracer = h.tritonTracer.tracer();

                // start a span
                span = tracer.startSpan('hello', fields);
                span.addTags({
                    component: 'triton-tracer-test'
                });

                state.spanCtx = span._context;
                cls.run(function _inCls() {
                    cls.set('tritonTraceSpan', span);
                    state.client.get({
                        headers: {connection: 'close'},
                        path: '/hi',
                        retry: {
                            minTimeout: 100,
                            maxTimeout: 500,
                            retries: 4
                        }
                    }, function _getHi(err /* , req, res, obj */) {
                        t.ok(err && err.code === 'ECONNREFUSED',
                            'expected ECONNREFUSED, got: ' + ((err && err.code)
                            ? err.code : JSON.stringify(err)));
                        cb();
                    });
                });
            }, function checkResults(state, cb) {
                var idx;

                t.equal(logs.length, 5, 'should have 5 request logs');

                for (idx = 0; idx < 5; idx++) {
                    t.equal(logs[idx].traceId, state.spanCtx._traceId,
                        'req[' + idx + '] has correct traceId');
                    t.equal(logs[idx].parentSpanId, state.spanCtx._spanId,
                        'req[' + idx + '] has correct parentSpanId');
                    t.equal(logs[idx].tags.attempt, idx,
                        'req[' + idx + '] has correct tags.attempt');
                    t.equal(logs[idx].tags['error.code'], 'ECONNREFUSED',
                        'req[' + idx + '] has tags["error.code"] ECONNREFUSED');
                    t.equal(logs[idx].tags['http.url'], '/hi',
                        'req[' + idx + '] has tags["http.url"] /hi');
                    t.equal(seenSpans[logs[idx].spanId], undefined,
                        'req[' + idx + '] should have a unique spanId');
                    seenSpans[logs[idx].spanId] = idx;
                }

                cb();
            }
        ]
    }, function _pipelineComplete(err /* , results */) {
        t.comment('cleanup');
        t.ifError(err, 'completed request and retries');
        t.end();
    });
});
