OVERVIEW
========

This contains some initial work/prototyping on an opentracing backend for use
with Triton and some wrappers to make it easier to integrate with restify.

For some more idea what this is about see [RFD 35](https://github.com/joyent/rfd/tree/master/rfd/0035).

Very Alpha. Not to be used for anything.


## Notes

 - abstracts out the opentracing stuff
 - requires minimal code changes to get started

## API

### Initalizing the tracer

In every program, the triton tracer should be initialized exactly once. Usually
this would happen just after the bunyan logger is created but before you've done
any interesting work in the program. To initialize the tracer you call
`tritonTracer.init()` like:

```
var tritonTracer = require('triton-tracer');

tritonTracer.init({
    log: log
});
```

The `log` parameter should be a bunyan logger to which trace events will be
written. If the trace is enabled these go to the `info` level. If this trace is
disabled, the log goes to the `trace` level which we expect will not be written
to disk (unless debugging) but does make them available to `bunyan -p` and
`dtrace`.

It is also possible to pass a `sampling` property along with the options object
as the `tritonTracer.init` argument, sampling is discussed in a later section.

### Instrumenting a restify server

In order to instrument your restify servier you should add code like the
following after you create your server with `restify.createServer`:

```js
var tritonTracer = require('triton-tracer');

tritonTracer.instrumentRestifyServer({
    server: server,
    ignoreRoutes: null
});
```

where the `server` parameter is the server object returned by `restify.createServer`,
and the optional `ignoreRoutes` is an array of route names that will not be
traced, e.g.:

```js
tritonTracer.instrumentRestifyServer({
    server: server,
    ignoreRoutes: ['heartbeat', 'ping']
});
```

Doing this will instrument the server using `server.use` and
`server.on('after', ...)` with the appropriate handlers so that:

 * every incoming request will cause a span to be created (child span if
   inbound headers indicate that this is part of an existing trace)
 * every handler will have the `tritonTraceSpan` information set in its
   continuation-local-storage context so that other instrumented components
   (such as restify clients) will automatically know which span they belong to.
 * when a request has been handled, the span will be finished and a log written
   to the bunyan logger that was passed to `tritonTracer.init`.


### Instrumenting restify clients

This depends on new functionality in restify-clients so you'll need a version with:

https://github.com/restify/clients/pull/95

once you have that, you can instrument your clients object as follows:

```
var restifyClients = require('restify-clients');
var tritonTracer = require('triton-tracer');

// Wrap the clients with tracing magic.
restifyClients = tritonTracer.wrapRestifyClients({
    restifyClients: restifyClients
});
```

at this point every client created with any of:

 * restifyClients.createHttpClient
 * restifyClients.createStringClient
 * restifyClients.createJsonClient

will automatically add a `before` and `after` which will:

 * create a new span for outgoing request (child span of current span if there is one)
 * add tracing headers to all outgoing requests
 * log events for each outgoing request when the request is made and when the
   response is received along with some additional data about the trace
 * finish the span and write it to the bunyan logger passed to `tritonTracer.init`

### Instrumenting sdc-clients

The version of sdc-clients at [insert link] is already setup to use the
instrumented `restify-clients`.

### Creating a local span

```
tritonTracer.localSpan('span name', {}, function _mySpan(err, span) {
    span.log({event: 'begin'});

    // Do some work

    span.log({event: 'end'});
    span.addTags({
        error: hadError ? true : undefined,
        // more tags
    });
    span.finish();
});
```

### Adding support for other components

In general we'd like to lean toward having a mechanism to enable instrumentation
in components which requires as little work as possible on the part of the
consumer of that component. This section will explain the basics of what you
need to do in order to add support to your component so that it can work like
one of either the restify clients or restify server instrumentations above.

### Gotchas

#### node bugs and versions

While support for the mechanisms used by cls has been in node.js since node
v0.11, the APIs have changed a few times and like many APIs in node are not
fully stable. This triton tracer module intends to keep itself compatible with
node versions v4.x where x >= 5, but there are some known issues in node that
impact some uses of cls.

The biggest known issue is surrounding the node HTTP Parser, where the issue is
that use of an HTTP Parser can cause the context of a given function to be
swapped incorrectly. This issue is further described here:

https://github.com/misterdjules/repro-async-wrap-http-parser-duplicate-id

If you're just using the existing instrumented clients you can largely ignore
this bug unless for some reason you're creating an using an HTTP Parser after
restify has processed your request and before some other component is called
which needs to know the current span.

If you're instrumenting something which is also dealing with HTTP Parser objects
as part of the continuation chain, you'll want to understand the issue here and
how to work around it.

