//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

function restifyClientFromReq(oriClient, req) {
    var client;
    var span;
    var spanCtx;
    var tracer;

    assert.object(oriClient, 'oriClient');
    assert.object(req, 'req');
    assert.object(req.tritonTraceSpan, 'req.tritonTraceSpan');

    spanCtx = req.tritonTraceSpan.context();
    tracer = req.tritonTraceSpan.tracer()._imp._interface;

    // create a traced version of the client with our span
    client = oriClient.child({
        before: function _addHeaders(opts) {
            // outbound request means a new span
            span = tracer.startSpan('client_request', {childOf: spanCtx});
            console.dir(span);
            // Add headers to our outbound request
            tracer.inject(span.context(), tracer.FORMAT_TEXT_MAP, opts.headers);
            span.log({event: 'client-request'});
        }, after: function _onResponse(/* r_err, r_req, r_res */) {
            // TODO: handle error?
            span.log({event: 'client-response'});
            span.finish();
        }
    });

    // TODO what can go wrong?

    return (client);
}

module.exports = {
    restifyClientFromReq: restifyClientFromReq
};
