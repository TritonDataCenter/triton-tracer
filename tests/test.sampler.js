//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
/* eslint-disable no-magic-numbers */

var sampler = require('../lib/sampler');
var test = require('tape');

// functions to test
var getProb = sampler._getProb;
var getSampleProb = sampler._getSampleProb;
var shouldEnable = sampler.shouldEnable;

test('getProb finds probabilities',
function _testGetProb(t) {
    var splitSampled = {
        sampledProps: {
            endpoint: {
                foo: 0.9
            }, GET: {
                '/fancy/pants': 0.6
            }
        }, sampledRegexps: {
            GET: {
                '^/vms/[^\/]+/jobs$': 0.04,
                '^/fancy/.*$': 0.7
            }
        }
    };

    t.equal(getProb('endpoint', 'foo', splitSampled), 0.9,
        'getProb finds "foo" == 0.9');
    t.equal(getProb('endpoint', 'bar', splitSampled), undefined,
        'getProb finds "bar" == undefined (not in sampling)');
    t.equal(getProb('GET', '/vms/deadbeef/jobs', splitSampled), 0.04,
        'getProb finds "/vms/deadbeef/jobs" == 0.04 (RegExp match)');
    t.equal(getProb('GET', '/fancy/pants', splitSampled), 0.6,
        'getProb finds "/fancy/pants" == 0.6 (tie goes to string)');

    t.end();
});

test('getSampleProb finds probabilities',
function _testGetSampleProb(t) {
    var sampling = {
        route: {
            ping: 0.01,
            stats: 0.02
        }, GET: {
            '/ping': 0.03,
            '^/vms/[^/]*/jobs$': 0.04
        }
    };

    t.equal(getSampleProb({route: 'ping'}, sampling), 0.01,
        '"ping" prob is 0.01');
    t.equal(getSampleProb({route: 'stats'}, sampling), 0.02,
        '"stats" prob is 0.02');
    t.equal(getSampleProb({route: 'pork'}, sampling), undefined,
        '"pork" prob is undefined (not in sampling)');
    t.equal(getSampleProb({route: 'stat'}, sampling), undefined,
        '"stat" prob is undefined (no accidental sub-match)');
    t.equal(getSampleProb({GET: '/ping'}, sampling), 0.03,
        '"/ping" prob is 0.03');
    t.equal(getSampleProb({GET: '/vms/1234/jobs'}, sampling), 0.04,
        '"/vms/1234/jobs" prob is 0.04 (RegExp match)');

    t.end();
});

test('shouldEnable chooses correctly',
function _testShouldEnable(t) {
    var sampling = {
        route: {
            ping: 0.01,
            stats: 0.02
        }, GET: {
            '/ping': 0.03,
            '/vms/*': 0.04
        }
    };

    t.equal(shouldEnable({route: 'ping'}, sampling, 0.001), true,
        '"ping" enabled on 0.001');
    t.equal(shouldEnable({route: 'ping'}, sampling, 0.1), false,
        '"ping" disabled on 0.1');
    t.equal(shouldEnable({route: 'moose'}, sampling, 0.001), true,
        '"moose" enabled on 0.001 (hits default)');
    t.equal(shouldEnable({GET: '/ping'}, sampling, 0.001), true,
        '"/ping" enabled on 0.001');

    t.end();
});

test('shouldEnable should be at least somewhat random',
function _testShouldEnableRandomness(t) {
    var flip;
    var numFlips = 100;
    var numHeads = 0;
    var numTails = 0;
    var sampling = {
        route: {
            coinflip: 0.5
        }
    };

    for (flip = 0; flip < numFlips; flip++) {
        if (shouldEnable({route: 'coinflip'}, sampling)) {
            numHeads++;
        } else {
            numTails++;
        }
    }

    t.ok(numHeads > 0, numFlips + ' tries lead to ' + numHeads + ' enablings');
    t.ok(numTails > 0, numFlips + ' tries lead to ' + numTails + ' disablings');

    t.end();
});
