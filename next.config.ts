import type { NextConfig } from "next";

import { MAX_UPLOAD_BYTES } from "./lib/formats";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server actions are our upload API, so the body limit has to cover the
      // largest file a server-side adapter will accept.
      bodySizeLimit: MAX_UPLOAD_BYTES,
    },
  },
  // exceljs and mammoth are CommonJS with optional native-ish deps; keeping them
  // external stops the bundler from trying to inline them into the server build.
  /*
   * External, which here means "left on disk as files" rather than bundled.
   *
   * That distinction is the whole point for the three parsers: the child
   * process resolves them from `node_modules` at runtime, and a copy compiled
   * into a server chunk is invisible to it. `xlsx` was missing from this list,
   * so it was bundled — present for the server, absent for the only thing that
   * actually loads it.
   */
  serverExternalPackages: ["exceljs", "mammoth", "xlsx", "isomorphic-dompurify"],
  /*
   * The parse child is spawned by path at runtime rather than imported, so
   * nothing in the module graph points at it and the deployment's file tracing
   * would leave it behind — the server would start fine and every Office file
   * would fail on the first upload.
   */
  outputFileTracingIncludes: {
    "/**": ["./lib/parse-child.mjs"],
  },
};

export default nextConfig;
