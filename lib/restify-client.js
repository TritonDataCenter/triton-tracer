//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var cls = require('continuation-local-storage');
var opentracing = require('opentracing');
var restifyClients = require('restify-clients');
var TritonConstants = require('./ot-constants');

var session = cls.getNamespace(TritonConstants.CLS_NAMESPACE);
if (!session) {
    session = cls.createNamespace(TritonConstants.CLS_NAMESPACE);
}

function addTracingOpts(options) {

    session.run(function _instrumentClient() {
        options.beforeSync = function _addHeaders(opts) {
            var parentSpan = session.get('tritonTraceSpan');
            var tags = {
                component: 'restifyclient',
                'span.kind': 'request'
            };
            var tracer;

            if (!parentSpan) {
                assert.ok(!false, 'TODO: implement creation of new span');
            }

            tracer = parentSpan.tracer();

            /*
            if (clientName) {
                tags['client.name'] = clientName || 'unknown'; // XXX How will we know we're a vmapi client?
            }
            */

            // outbound request means a new span
            span = tracer.startSpan('restify_request', {
                childOf: parentSpan.context(),
                tags: tags
            });

            session.set('tritonTraceRequestSpan', span);

            // Add headers to our outbound request
            tracer.inject(span.context(), opentracing.FORMAT_TEXT_MAP, opts.headers);
            span.log({event: 'client-send-req'});
        };

        options.afterSync = function _onResponse(r_err, r_req, r_res) {
            var span = session.get('tritonTraceRequestSpan');
            var tags = {
                error: r_err ? 'true' : undefined,
            };

            console.log('after got span: ' + JSON.stringify(span.context()));

            assert.object(span, 'span');

            if (r_res) {
                tags['client.bytes_read'] = r_res.client.bytesRead;
                tags['client.bytes_dispatched'] = r_res.client._bytesDispatched;
                tags['http.headers'] = r_res.headers;
                tags['http.status_code'] = r_res.statusCode;
            }

            if (r_req) {
                tags['http.method'] = r_req.method;
                tags['http.url'] = r_req.path;
                tags['peer.addr'] = r_req.connection.remoteAddress;
                tags['peer.port'] = r_req.connection.remotePort;
            }

            span.log({event: 'client-recv-res'});
            span.addTags(tags);
            span.finish();

            // Just to ensure we don't re-use
            session.set('tritonTraceRequestSpan', undefined);
        };
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
