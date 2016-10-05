//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var opentracing = require('opentracing');

// Returns a restify client that's a child of oriClient but creates and logs a
// span for every request made.
//
// The optional clientName can be used to set a client.name tag on the span.
function child(oriClient, req, clientName) {
    assert.object(oriClient, 'oriClient');
    assert.object(req, 'req');
    assert.object(req.tritonTraceSpan, 'req.tritonTraceSpan');

    return oriClient.child({
        beforeSync: function _addHeaders(opts, ctx) {
            var span;
            var spanCtx;
            var tags = {
                component: 'restifyclient',
                'span.kind': 'request'
            };
            var tracer;

            spanCtx = req.tritonTraceSpan.context();
            tracer = req.tritonTraceSpan.tracer();

            if (clientName) {
                tags['client.name'] = clientName;
            }

            // outbound request means a new span
            span = tracer.startSpan('restify_request', {
                childOf: spanCtx,
                tags: tags
            });

            ctx.tritonSpan = span;

            // Add headers to our outbound request
            tracer.inject(span.context(), opentracing.FORMAT_TEXT_MAP, opts.headers);
            span.log({event: 'client-send-req'});
        }, afterSync: function _onResponse(r_err, r_req, r_res, ctx) {
            var span = ctx.tritonSpan;

            span.log({event: 'client-recv-res'});
            span.addTags({
                'client.bytes_read': r_res.client.bytesRead,
                'client.bytes_dispatched': r_res.client._bytesDispatched,
                error: r_err ? 'true' : undefined,
                'http.headers': r_res.headers, // TODO: cut this down to a specific list of headers
                'http.method': r_req.method,
                'http.status_code': r_res.statusCode,
                'http.url': r_req.path,
                'server.addr': r_req.connection.remoteAddress,
                'server.port': r_req.connection.remotePort
            });
            span.finish();
        }
    });

    // TODO what can go wrong?
}

module.exports = {
    child: child
};
