//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

var _global = require('../global');

// starts a new span (child of current tritonTraceSpan if that's set) and then
// calls:
//
//  callback(err, span);
//
function createLocalSpan(spanName, options, callback) {
    var cls = _global.cls();
    var fields = {};
    var parentSpan = cls.get('tritonTraceSpan');
    var span;
    var tracer = _global.tracer();

    assert.string(spanName, 'spanName');
    assert.optionalObject(options, 'options');
    assert.func(callback, 'callback');
    assert.optionalObject(parentSpan, 'cls.tritonTraceSpan');

    if (parentSpan) {
        fields.childOf = parentSpan.context();
    }

    span = tracer.startSpan(spanName, fields);

    callback(null, span);
}

module.exports = {
    createLocalSpan: createLocalSpan
};
