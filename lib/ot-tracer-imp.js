//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var uuid = require('node-uuid');

var TritonConstants = require('./ot-constants');
var TritonSpan = require('./ot-span-imp');
var TritonSpanContext = require('./ot-spancontext-imp');

// "Magic" fields that will be in every bunyan log message written by the span
// logger. This allows users to filter these messages out with grep / bunyan -c.
var TRITON_MAGIC = {TritonTracing: 'TRITON'};

function TritonTracer(opts) {
    var self = this;

    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');

    self._interface = null;
    self._log = opts.log.child(TRITON_MAGIC);
}

TritonTracer.prototype.setInterface = function setInterface(tracerInterface) {
    this._interface = tracerInterface;
};

TritonTracer.prototype.startSpan = function startSpan(fields) {
    var self = this;
    var idx;
    var parentCtx;
    var ref;
    var span;
    var spanCtx;
    var spanId = uuid.v4();
    var traceId;

    assert.object(fields, 'fields');
    assert.optionalArray(fields.references, 'fields.references');
    assert.optionalObject(fields.continuationOf, 'fields.continuationOf');

    // First see if we have a parent, if so get its Ctx
    if (fields.references) {
        // having .references means we're either a childOf or followsFrom
        // either way, the first valid reference is considered our parent.
        for (idx = 0; idx < fields.references.length; idx++) {
            ref = fields.references[idx];
            if ([
                this._interface.REFERENCE_CHILD_OF,
                this._interface.REFERENCE_FOLLOWS_FROM
            ].indexOf(ref.type()) !== -1) {
                // first match is our parent
                parentCtx = ref.referencedContext().imp();
                break;
            }
        }
    } else if (fields.continuationOf) {
        // Joining an existing trace as either the first span (when value has no
        // _spanId) or also joining an existing span.
        parentCtx = fields.continuationOf.imp();
        assert.uuid(parentCtx._traceId, 'parentCtx._traceId');
        if (parentCtx._spanId) {
            spanId = parentCtx._spanId;
            // Otherwise: we're creating a root span, so keep the new
            // generated one.
        }
    }

    traceId = parentCtx ? parentCtx._traceId : uuid.v4();

    spanCtx = new TritonSpanContext(spanId, traceId);
    span = new TritonSpan(self, spanCtx);

    // TODO: Do we need to span.addTags() for the default tags? Or support
    //       default tags at all?
    span.setFields(fields);

    // When there's no parentCtx._spanId we're the root span for this trace.
    if (parentCtx && parentCtx._spanId && (parentCtx._spanId !== spanId)) {
        span.setParentSpanId(parentCtx._spanId);
    }

    // this might get overriden later by .setFields()
    span._beginTimestamp = (new Date()).getTime();

    return (span);
};

TritonTracer.prototype.inject = function inject(spanCtx, format, carrier) {
    var self = this;

    assert.object(spanCtx, 'spanCtx');
    assert.uuid(spanCtx._spanId, 'spanCtx._spanId');
    assert.uuid(spanCtx._traceId, 'spanCtx._traceId');
    assert.equal(format, self._interface.FORMAT_TEXT_MAP, 'Unsupported format');
    assert.object(carrier, 'carrier');

    // We only support "TextMap" format which we assume for now is a restify
    // opts.headers object.

    // We use request-id instead of triton-trace-id for historical reasons (See
    // RFD 35). Also: restify natively supports request-id already.
    carrier['request-id'] = spanCtx._traceId;
    carrier['triton-span-id'] = spanCtx._spanId;
    carrier['triton-trace-enable'] = spanCtx._traceEnabled;
    if (spanCtx._traceExtra) {
        carrier['triton-trace-extra'] = spanCtx._traceExtra;
    }
};

TritonTracer.prototype.extract = function extract(format, carrier) {
    var spanCtx = null;
    var spanId;
    var traceEnabled;
    var traceExtra;
    var traceId;

    assert.equal(format, TritonConstants.RESTIFY_REQ_CARRIER,
        'Unsupported format');
    assert.object(carrier, 'carrier');

    // We only support a restify req object as the carrier

    // TODO: Are there cases where we'd not want to trust these headers?
    //       Open question in RFD 35.
    spanId = carrier.header('triton-span-id', undefined);
    traceEnabled = carrier.header('triton-trace-enable', true);
    traceExtra = carrier.header('triton-trace-extra', undefined);
    traceId = carrier.getId(); // Remember: carrier is a restify 'req'

    if (traceId) {
        spanCtx = new TritonSpanContext(spanId, traceId);
    }

    spanCtx._traceEnabled = Boolean(traceEnabled);
    spanCtx._traceExtra = traceExtra;

    // TODO Warning message when we're returning null?

    return (spanCtx);
};

module.exports = TritonTracer;
