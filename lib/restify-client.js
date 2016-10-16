//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var restifyClients = require('restify-clients');

function addTracingOpts(options) {
    var globalSession = process.tritonTracer.getSession();

    options.beforeSync = globalSession.bind(function _beforeSync(opts) {
        var fields = {};
        var parentSpan;
        var session = process.tritonTracer.getSession();
        var tags = {
            component: 'restifyclient',
            'span.kind': 'request'
        };
        var tracer = session.get('TritonTracer');

        parentSpan = session.get('tritonTraceSpan');

        // TODO: add mechanism for passing through tags['client.name']

        // outbound request means a new span
        span = tracer.startSpan('restify_request', {
            childOf: (parentSpan ? parentSpan.context() : undefined),
            tags: tags
        });

        session.set('reqSpan', span);

        // Add headers to our outbound request
        tracer.inject(span.context(), opentracing.FORMAT_TEXT_MAP, opts.headers);
        span.log({event: 'client-send'});
    });

    options.afterSync = globalSession.bind(function _afterSync(err, req, res) {
        var session = process.tritonTracer.getSession();

        var span = session.get('reqSpan');
        var tags = {
            error: (err ? 'true' : undefined),
        };

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
    });
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

/*
restifyClients.HttpClient.prototype.Request
    = restifyClients.HttpClient.prototype.request;
restifyClients.HttpClient.prototype.request = function request(opts, cb) {
    var self = this;
    var oriArgs = arguments;

    session.run(function () {
        self.Request.apply(self, oriArgs);
    });
};
*/

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
