//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

var UNSUPPORTED_BAGGAGE = '"baggage" items are not currently supported';

function TritonSpanContext(spanId, traceId) {
    var self = this;

    assert.optionalUuid(spanId, 'spanId');
    assert.uuid(traceId, 'traceId');

    self._spanId = spanId || '0'; // '0' means we're a root span
    self._traceEnabled = undefined;
    self._traceExtra = undefined;
    self._traceId = traceId;
}

TritonSpanContext.prototype.setBaggageItem = // eslint-disable-line
function setBaggageItem(/* key, value */) {
    assert.ok(!true, UNSUPPORTED_BAGGAGE);
};

TritonSpanContext.prototype.getBaggageItem = // eslint-disable-line
function getBaggageItem(/* key */) {
    assert.ok(!true, UNSUPPORTED_BAGGAGE);
};

TritonSpanContext.prototype.forEachBaggageItem = // eslint-disable-line
function forEachBaggageItem(/* f */) {
    assert.ok(!true, UNSUPPORTED_BAGGAGE);
};

module.exports = TritonSpanContext;
