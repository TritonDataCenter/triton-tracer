//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

function TritonSpan(tracer, context) {
    var self = this;

    assert.object(tracer, 'tracer');
    assert.object(context, 'context');

    self._beginTimestamp = 0;
    self._context = context;
    self._elapsed = 0;
    self._ended = false;
    self._endTimestamp = 0;
    self._errorFlag = false;
    self._logs = [];
    self._operation = '';
    self._parentSpanId = undefined;
    self._tags = {};
    self._tracer = tracer;
}

TritonSpan.prototype.tracer = function tracer() {
    var self = this;

    return (self._tracer);
};

TritonSpan.prototype.context = function context() {
    var self = this;

    return (self._context);
};

TritonSpan.prototype.setOperationName = function setOperationName(name) {
    var self = this;

    assert.string(name, 'name');

    self._operation = name;
};

TritonSpan.prototype.addTags = function addTags(keyValuePairs) {
    var self = this;
    var idx;
    var key;
    var keys;

    assert.object(keyValuePairs, 'keyValuePairs');

    keys = Object.keys(keyValuePairs);

    for (idx = 0; idx < keys.length; idx++) {
        key = keys[idx];
        self._tags[key] = keyValuePairs[key];
    }
};

//
// OpenTracing defines the following fields:
//
// 'event'     - string name for the event
// 'timestamp' - timestamp of the event (we assume from epoch in ms)
// 'payload'   - object of additional properties
//
TritonSpan.prototype.log = function log(fields) {
    var self = this;

    assert.object(fields);
    assert.optionalString(fields.event, 'fields.event');
    assert.optionalObject(fields.payload, 'fields.payload');
    assert.optionalNumber(fields.timestamp, 'fields.timestamp');

    self._logs.push({
        event: fields.event,
        payload: fields.payload,
        timestamp: fields.timestamp || (new Date()).getTime()
    });
};

TritonSpan.prototype.finish = function finish(finishTime) {
    var self = this;

    assert.ok(self._beginTimestamp > 0, 'Span was not started');
    assert.ok(!self._ended, 'Span already ended');
    assert.optionalNumber(finishTime, 'finishTime');

    self._ended = true;

    // TODO: add support for process.hrtime and more precision

    if (finishTime) {
        self._endTimestamp = finishTime;
    } else {
        self._endTimestamp = (new Date()).getTime();
    }

    self._elapsed = self._endTimestamp - self._beginTimestamp;

    // Actually write the log out
    self._tracer._log.info({
        begin: self._beginTimestamp,
        elapsed: self._elapsed,
        end: self._endTimestamp,
        logs: self._logs,
        operation: self._operation,
        parentSpanId: self._parentSpanId,
        spanId: self._context._spanId,
        tags: self._tags,
        traceId: self._context._traceId
    });
};

TritonSpan.prototype.setFields = function setFields(fields) {
    var self = this;
    var idx;
    var key;
    var keys;
    var value;

    assert.object(fields, 'fields');

    keys = Object.keys(fields);
    for (idx = 0; idx < keys.length; idx++) {
        key = keys[idx];
        value = fields[key];

        switch (key) {
            case 'continuationOf': // NOTE: local extension, not part of OT
            case 'references':
                // ignore these, handled already by startSpan()
                break;
            case 'operationName':
                assert.string(value, 'fields.operationName');
                self._operation = value;
                break;
            case 'startTime':
                // startTime is in milliseconds
                assert.number(value, 'fields.startTime');
                self._beginTimestamp = value;
                break;
            case 'tags':
                // addTags() validates value
                self.addTags(value);
                break;
            default:
                assert.ok(!true, 'unknown field: fields.' + key);
                break;
        }
    }
};

TritonSpan.prototype.setParentSpanId = function setParentSpanId(spanId) {
    var self = this;

    assert.uuid(spanId, 'spanId');

    self._parentSpanId = spanId;
};

module.exports = TritonSpan;
