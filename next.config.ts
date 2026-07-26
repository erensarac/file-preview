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
  serverExternalPackages: ["exceljs", "mammoth", "isomorphic-dompurify"],
};

export default nextConfig;
