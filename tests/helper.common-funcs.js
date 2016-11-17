//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
/* eslint-disable no-magic-numbers */

var forkexec = require('forkexec');
var restify = require('restify');
var restifyClients = require('restify-clients');
var tritonTracer = require('../index');

restifyClients = tritonTracer.wrapRestifyClients({
    restifyClients: restifyClients
});

// start a dummy HTTP server that outputs logs to stdout and emits the results
// when it exits.
function startServer(t, emitter, serverName, serverPort, clients, callback) {
    t.doesNotThrow(function _startServer() {
        var env = {
            HTTP_PORT: serverPort
        };

        if (process.env.DEBUG_CLS_HOOKED) {
            env.DEBUG_CLS_HOOKED = process.env.DEBUG_CLS_HOOKED;
        }

        forkexec.forkExecWait({
            argv: [process.execPath, __dirname + '/helper.dummy-server.js',
                '--', serverName],
            env: env
        }, function _startServerCb(err, info) {
            t.ifError(err, serverName + ' exited w/o error');
            if (!err) {
                emitter.emit(serverName, info);
            }
        });

        // Also create a client for this server
        clients[serverName] = {
            unwrapped: restify.createJsonClient({
                url: 'http://127.0.0.1:' + serverPort
            }), wrapped: restifyClients.createJsonClient({
                url: 'http://127.0.0.1:' + serverPort
            })
        };
    }, undefined, 'started ' + serverName);

    // server started as child process, now returning.
    callback();
}

function shutdownServer(t, emitter, state, serverName, clients, callback) {
    // setup a watcher for the event that will be emitted when the server
    // actually ends.
    emitter.once(serverName, function _waitServerA(info) {
        t.ok(info, 'saw exit info for ' + serverName);
        state.results[serverName] = info;

        // also remove the clients since the server is gone.
        delete clients[serverName];

        callback();
    });

    // Now that we're watching for exit, call the /goodbye endpoint which
    // triggers an exit.
    clients[serverName].unwrapped.post({
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

module.exports = {
    arrayifyStdout: arrayifyStdout,
    checkValidSpan: checkValidSpan,
    checkSpanProp: checkSpanProp,
    checkSpanTag: checkSpanTag,
    mkSpanObj: mkSpanObj,
    plausibleMsTimestamp: plausibleMsTimestamp,
    shutdownServer: shutdownServer,
    startServer: startServer,
    tritonTracer: tritonTracer
};
