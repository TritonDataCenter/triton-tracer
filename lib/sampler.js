//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');

function assertValidProbability(prob) {
    assert.ok(prob >= 0 && prob <= 1, 'probabilities must be between 0 and 1');
}

function splitSampling(sampling) {
    var prop;
    var propIdx;
    var propKeys;
    var sampledProps = {};
    var sampledRegexps = {};
    var type;
    var typeIdx;
    var typeKeys;

    typeKeys = Object.keys(sampling);
    for (typeIdx = 0; typeIdx < typeKeys.length; typeIdx++) {
        type = typeKeys[typeIdx];
        propKeys = Object.keys(sampling[type]);
        for (propIdx = 0; propIdx < propKeys.length; propIdx++) {
            prop = propKeys[propIdx];
            if (prop.substr(0, 1) === '^' && prop.substr(-1, 1) === '$') {
                // Assume it's a valid RegExp, will be checked when we try to
                // compile it later.
                if (!sampledRegexps.hasOwnProperty(type)) {
                    sampledRegexps[type] = {};
                }
                sampledRegexps[type][prop] = sampling[type][prop];

                assertValidProbability(sampling[type][prop]);
            } else {
                assert.string(prop, 'sampling.' + type + ' has non-string/non-'
                    + 'RegExp property');
                if (!sampledProps.hasOwnProperty(type)) {
                    sampledProps[type] = {};
                }
                sampledProps[type][prop] = sampling[type][prop];

                assertValidProbability(sampling[type][prop]);
            }
        }
    }

    return ({sampledProps: sampledProps, sampledRegexps: sampledRegexps});
}

function getProb(type, prop, splitSampled) {
    var prob;
    var re;
    var regexpIdx;
    var regexps;
    var sampledProps = splitSampled.sampledProps;
    var sampledRegexps = splitSampled.sampledRegexps;

    if (sampledProps[type]) {
        if (sampledProps[type].hasOwnProperty(prop)) {
            prob = sampledProps[type][prop];
        }
    }

    if (prob === undefined && sampledRegexps[type]) {
        // there are RegExps for this property, use if any match
        regexps = Object.keys(sampledRegexps[type]);
        for (regexpIdx = 0; regexpIdx < regexps.length; regexpIdx++) {
            re = new RegExp(regexps[regexpIdx]);
            if (prop.match(re)) {
                prob = sampledRegexps[type][regexps[regexpIdx]];
            }
        }
    }

    return (prob);
}

function getSampleProb(sampleObj, sampling) {
    var idx;
    var keys;
    var prob;
    var prop;
    var sampleProb;
    var splitSampled;
    var type;

    // split RegExps (start w/ ^, end w/ $) from plain strings
    splitSampled = splitSampling(sampling);

    // look at each key in the object and determine the probability based on any
    // that match the sampling object's definition.
    keys = Object.keys(sampleObj);
    for (idx = 0; idx < keys.length; idx++) {
        type = keys[idx];
        if (splitSampled.sampledProps.hasOwnProperty(type)
            || splitSampled.sampledRegexps.hasOwnProperty(type)) {
            // this exists somewhere in the sampling, figure out the probability
            prop = sampleObj[type];
            prob = getProb(type, prop, splitSampled);

            if (!isNaN(prob) && sampleProb === undefined || prob > sampleProb) {
                sampleProb = prob;
            }
        }
    }

    return (sampleProb);
}

// sampleObj will look like:
//
//  {
//      route: 'ping'
//  }
//
// or:
//
//  {
//      GET: '/ping'
//  }
//
// sampling will look like:
//
//  {
//      route: {
//          'ping': 0.01
//      }
//  }
//
// or:
//
//   {
//       GET: {
//           '/ping': 0.01
//       }
//   }
//
// Returns:
//
//   boolean (default true)
//
function shouldEnable(sampleObj, sampling, _randomNum) {
    var sampleProb;
    var randomNum = Math.random();

    assert.object(sampleObj, 'sampleObj');
    assert.object(sampling, 'sampling');

    // For testing allow a secret 3rd option that gives us a "random" value.
    if (_randomNum) {
        assert.finite(_randomNum, 'randomNum');
        randomNum = _randomNum;
    }

    sampleProb = getSampleProb(sampleObj, sampling);

    // if it is a number and a random choice is greater, it means we lost the
    // flip and we're not going to enable tracing for this one.
    if (!isNaN(sampleProb) && randomNum > sampleProb) {
        return (false);
    }

    // if undefined (!isNaN will have failed above) or our random choice was <
    // the sampleProb, we should enable tracing.
    return (true);
}

module.exports = {
    shouldEnable: shouldEnable,
    // the following exported only for testing:
    _getProb: getProb,
    _getSampleProb: getSampleProb,
    _splitSampling: splitSampling
};
