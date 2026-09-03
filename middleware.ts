import { NextResponse, type NextRequest } from "next/server";

/**
 * Refuses a POST that is shaped like a server action but is not one.
 *
 * ── What it fixes ────────────────────────────────────────────────────────
 *
 * A `multipart/form-data` POST to a page path made the framework try to decode
 * a server action, fail to find one, and throw — answering **500**. Measured
 * against the deployment, and locally:
 *
 *   multipart, no action header      500   ← the bug
 *   multipart, bogus action header   404
 *   urlencoded                       200
 *   text/plain, application/json     405
 *
 * A 500 is the wrong answer and, worse, an answer anyone can provoke with one
 * `curl`. The failure logging added for observability is where a real
 * regression is supposed to be visible, and this let a stranger fill it with
 * server errors that mean nothing.
 *
 * ── Why the header is the test ───────────────────────────────────────────
 *
 * Every genuine call here is invoked from client code, and React sends
 * `Next-Action` with the action's id when it does. Verified rather than
 * assumed: a real upload from a browser carries
 * `next-action: 40b1da20e1…` alongside its multipart body.
 *
 * The alternative shape — a `<form action={…}>` posting without JavaScript,
 * which carries the id in the body instead of a header — does not exist in
 * this app. If one is ever added, this check has to learn about it, because it
 * would refuse exactly that request. That is the trade being made, and it is
 * why the matcher is as narrow as it is: nothing without a multipart body and
 * no action header ever reaches this code.
 */
export function middleware(request: NextRequest) {
  // The matcher cannot express a method, so it is expressed here. A GET
  // carrying a multipart content-type is nonsense rather than an attack, and
  // answering 405 to it would be its own small bug.
  if (request.method !== "POST") return NextResponse.next();

  return new NextResponse(null, {
    status: 405,
    // What the other malformed shapes already get, so one wrong request does
    // not produce three different answers depending on its content type.
    headers: { allow: "GET, HEAD" },
  });
}

export const config = {
  matcher: [
    {
      /*
       * Deliberately not a catch-all with the conditions in code. Written that
       * way, middleware would run on every page request on the deployment to
       * decide it has nothing to do — a cost paid by all normal traffic to
       * catch a request that is not normal. `has`/`missing` keeps it off that
       * path entirely: a request without a multipart body, or with an action
       * header, never invokes this at all.
       */
      source: "/:path*",
      has: [
        { type: "header", key: "content-type", value: "multipart/form-data.*" },
      ],
      missing: [{ type: "header", key: "next-action" }],
    },
  ],
};
