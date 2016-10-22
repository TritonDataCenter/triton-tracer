//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var opentracing = require('opentracing');
var restifyClients = require('restify-clients');

var _global = require('../global');

function addTracingOpts(options) {

    options.after = function _afterSync(err, req, res, ctx, next) {
        var cls = _global.cls();
        var cls_span = cls.get('tritonTraceSpan');
        var span = ctx.tritonTraceSpan;
        var tags = {
            error: (err ? 'true' : undefined),
        };

        assert.object(span, 'ctx.tritonTraceSpan');

        console.log('AFTER CTX SPAN: ' + JSON.stringify(span.context()));
        console.log('AFTER CLS SPAN: ' + (cls_span ? JSON.stringify(cls_span.context()) : 'MISSING'));

        if (err && err.body && err.body.code) {
            tags['error.code'] = err.body.code;
        }

        if (res) {
            tags['client.bytes_read'] = res.client.bytesRead;
            tags['client.bytes_dispatched'] = res.client._bytesDispatched;
            tags['http.headers'] = res.headers;
            tags['http.status_code'] = res.statusCode;
        }

        if (req) {
            tags['http.method'] = req.method;
            tags['http.url'] = req.path;
            tags['peer.addr'] = req.connection.remoteAddress;
            tags['peer.port'] = req.connection.remotePort;
        }

        span.log({event: 'client-recv'});
        span.addTags(tags);
        span.finish();
        next();
    };

    options.before = function _beforeSync(opts, next) {
        var cls = _global.cls();
        var ctx = {};
        var parentSpan = cls.get('tritonTraceSpan');
        var fields = {};
        var tags = {
            component: 'restifyclient',
            'http.host': opts.host,
            'http.method': opts.method,
            'http.url': opts.path,
            'span.kind': 'request'
        };
        var tracer = _global.tracer();

        // TODO: add mechanism for passing through tags['client.name']

        // outbound request means a new span
        span = tracer.startSpan('restify_request', {
            childOf: (parentSpan ? parentSpan.context() : undefined),
            tags: tags
        });

        // Add headers to our outbound request
        tracer.inject(span.context(), opentracing.FORMAT_TEXT_MAP, opts.headers);
        span.log({event: 'client-send'});

        cls.run(function _runNext() {
            cls.set('tritonTraceSpan', span);
            ctx.tritonTraceSpan = span;
            next(ctx);
        });
    };
}

function createClient(options) {
    addTracingOpts(options);
    return (restifyClients.createClient(options));
}

function createJsonClient(options) {
    addTracingOpts(options);
    return (restifyClients.createJsonClient(options));
}

function createStringClient(options) {
    addTracingOpts(options);
    return (restifyClients.createStringClient(options));
}

function createHttpClient(options) {
    addTracingOpts(options);
    return (restifyClients.createHttpClient(options));
}

// Matches the sinature of restify-clients
module.exports = {
    // Client API
    createClient: createClient,
    createJsonClient: createJsonClient,
    createJSONClient: createJsonClient,
    createStringClient: createStringClient,
    createHttpClient: createHttpClient,
    get HttpClient() {
        return restifyClients.HttpClient;
    },
    get JsonClient() {
        return restifyClients.JsonClient;
    },
    get StringClient() {
        return restifyClients.StringClient;
    },
    bunyan: restifyClients.bunyan
};
