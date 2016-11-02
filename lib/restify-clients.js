//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var opentracing = require('opentracing');

var _global = require('../global');
var sampler = require('./sampler');

// module variables
var restifyClients;

function addTracingOpts(options) {
    var tracer = _global.tracer();

    if (!tracer) {
        // tracing is not enabled, don't add before/after hooks
        return;
    }

    options.after = function _afterSync(err, req, res, ctx, next) {
        var span = ctx.tritonTraceClientSpan;
        var tags = {
            error: (err ? 'true' : undefined)
        };

        assert.object(span, 'ctx.tritonTraceClientSpan');

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
        var span;
        var sampling;
        var sampleObj = {};
        var tags = {
            component: 'restifyclient',
            'http.host': opts.host,
            'http.method': opts.method,
            'http.url': opts.path,
            'span.kind': 'request'
        };

        if (options.clientName) {
            tags['client.name'] = options.clientName;
        }
        sampling = options.tritonSampling;

        fields.tags = tags;
        if (parentSpan) {
            fields.childOf = parentSpan.context();
        } else if (sampling) {
            // New span, so we need to figure out if tracing should be enabled
            // or not. If there's no sampling information or if the sampler says
            // we should include this, we enable tracing.
            sampleObj[opts.method] = opts.path;
            fields.enable = sampler.shouldEnable(sampleObj, sampling);
        }

        // outbound request means a new span
        span = tracer.startSpan('restify_request', fields);

        // Add headers to our outbound request
        tracer.inject(span.context(), opentracing.FORMAT_TEXT_MAP,
            opts.headers);
        span.log({event: 'client-send'});

        ctx.tritonTraceClientSpan = span;
        next(ctx);
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

function wrapRestifyClients(options) {
    assert.object(options, 'options');
    assert.object(options.restifyClients, 'options.restifyClients');
    assert.optionalString(options.clientName, 'options.restifyClients');

    restifyClients = options.restifyClients;

    // Matches the sinature of restify-clients
    return ({
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
    });
}

//
// To create a wrapped restify-clients object you can do:
//
//  var restifyClients = require('restify-clients');
//  var tritonTracer = require('triton-tracer');
//  restifyClients = tritonTracer.wrapRestifyClients({
//      restifyClients: restifyClients
//  });
//
// And at that point you can use restifyClients just as you would have if it
// were not wrapped. The difference will be that all clients created will have
// the before and after options passed (when tracing is enabled) with functions
// that will handle creating and logging spans.
//
// An additional option can be added to the tritonTracer.wrapRestifyClients()
// argument option with key 'clientName' and the value being a string. If
// passed, this clientName will be used to set a 'client.name' tag on all spans
// created. This is most useful if you are creating a library that uses
// restify-clients and want to have traces identify you client. For an API
// "FooAPI" for example, I might want to have client.name set to 'FooAPI client'
// in which case I'd add the option:
//
//     clientName: 'FooAPI client',
//
// to the object I pass to wrapRestifyClients.
//
module.exports = {
    // _addTracingOpts exported only for tests.
    _addTracingOpts: addTracingOpts,
    wrapRestifyClients: wrapRestifyClients
};