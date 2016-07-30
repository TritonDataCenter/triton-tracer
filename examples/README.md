OVERVIEW
========

The example apps here all do the same thing but show the impact of adding
tracing and the difference between doing it the hard way (using just raw
opentracing and the opentracing Tracer implementation in the triton-tracing
module) and using the helpers which allow you to avoid some boilerplate.

The two versions that support tracing both currently assume that you've got a
modified version of restify which supports the .child() function and the
'before' and 'after' methods. The package.json should give you the right thing
if you just `npm install` it.

TODO
====

 * Add some local processing in the handler to demonstrate how that will look
   when being tracked.
