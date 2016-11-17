//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//
/* eslint-disable no-magic-numbers */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var EventEmitter = require('events').EventEmitter;
var restify = require('restify');
var restifyClients = require('restify-clients');
var tritonTracer = require('../index');

var log = new bunyan({
    name: 'dummyserver'
});
var server;

// GLOBAL
var APP_PORT = process.env.HTTP_PORT || 8080; // eslint-disable-line
var HTTP_OK = 200; // eslint-disable-line
var RANDOM_WORK = 0.00000001; // eslint-disable-line
var TIMEOUT_DELAY = 10;

restifyClients = tritonTracer.wrapRestifyClients({
    restifyClients: restifyClients
});

tritonTracer.init({log: log});

server = restify.createServer({
    name: 'Dummy Server'
});

tritonTracer.instrumentRestifyServer({server: server});

// ensure we exit when parent dies
function _exitOnStdoutEnd() {
    process.exit(0);
}
process.stdout.resume();
process.stdout.on('end', _exitOnStdoutEnd);
process.stdout.unref();

function debug(req, res, next) {
    var ctx = {};
    var span = tritonTracer.currentSpan();

    if (span) {
        ctx = span._context;
    }

    res.send(HTTP_OK, {
        spanCtx: ctx,
        reqHeaders: req.headers
    });
    next();
}

// same as debug but just after a random delay
function delayedDebug(req, res, next) {
    var randDelay = Math.floor(Math.random() * 50);

    req.headers['x-random-delay'] = randDelay;
    setTimeout(function _callDebug() {
        debug(req, res, next);
    }, randDelay);
}

function goodbye(req, res, next) {
    res.send(HTTP_OK, {reply: 'goodbye'});
    // shutdown the server ASAP
    setImmediate(function _closeASAP() {
        server.close();
    });
    next();
}

function hello(req, res, next) {
    res.send(HTTP_OK, {reply: 'hello'});
    next();
}

// send a GET request to another server on :port
function proxyGET(req, res, next) {
    var client;
    var endpoint;
    var url;

    assert.object(req.params, 'req.params');
    assert.string(req.params.endpoint, 'req.params.endpoint');
    assert.string(req.params.port, 'req.params.port');
    assert.finite(Number(req.params.port), 'req.params.port');
    assert.func(next, 'next');

    endpoint = '/' + req.params.endpoint;
    url = 'http://127.0.0.1:' + req.params.port;

    client = restifyClients.createJsonClient({url: url});
    client.get({
        headers: {connection: 'close'},
        path: endpoint
    }, function _proxyGetCb(_err, _req, _res, _obj) {
        assert.ifError(_err, 'unexpected problem proxying request: '
            + (_err ? _err.message : 'unknown error'));

        // TODO: should we log _res.headers?

        res.send(_res.statusCode, _obj);
        next();
    });
}

// This handler tries a number of things that could possibly throw off the cls
// implementation and cause us to somehow not have the span info when we make a
// request. Then it just calls the proxyGET function.
function trickyProxyGET(req, res, next) {
    var emitter = new EventEmitter();

    emitter.once('trickEmit', function _trickEmitted() {
        proxyGET(req, res, next);
    });

    setImmediate(function _immediatelyTricky() {
        process.nextTick(function _nextTickTrick() {
            setTimeout(function _delayTrick() {
                emitter.emit('trickEmit');
            }, TIMEOUT_DELAY);
        });
    });
}

// Does something then returns a number
// Creates a local span as one would do around any local work.
function doWork(callback) {
    var count = 0;

    tritonTracer.localSpan('do_work', {}, function _doWork(err, span) {
        if (err) {
            callback(err);
            return;
        }

        // "log" an event indicating we're starting
        span.log({event: 'start-work'});

        // This is where the "work" happens
        while (Math.random() > RANDOM_WORK) {
            count++;
        }

        span.addTags({
            'random.loops': count
        });

        // "log" an event indicating we're done, then finalize the span
        span.log({event: 'done-work'});
        span.finish();

        callback(null, count);
    });
}

function work(req, res, next) {
    doWork(function _doneWork(err, count) {
        assert.ifError(err, 'unexpected error from doWork');
        res.send(HTTP_OK, {reply: 'did ' + count + ' works'});
        next();
    });
}

server.get({
    name: 'Debug',
    path: '/debug'
}, debug);

server.get({
    name: 'DelayedDebug',
    path: '/delayeddebug'
}, delayedDebug);

server.post({
    name: 'Goodbye',
    path: '/goodbye'
}, goodbye);

server.get({
    name: 'Hello',
    path: '/hello'
}, hello);


server.get({
    name: 'ProxyGet',
    path: '/proxy/:port/:endpoint'
}, proxyGET);

server.get({
    name: 'TrickyProxyGet',
    path: '/trickyproxy/:port/:endpoint'
}, trickyProxyGET);

server.post({
    name: 'Work',
    path: '/work'
}, work);

server.listen(APP_PORT, function _onListen() {
    log.info({server_name: server.name, server_url: server.url}, 'listening');
});
