/**
 * The canonical origin.
 *
 * Absolute URLs are needed for canonical tags, Open Graph and the sitemap, and
 * they have to match the deployed origin or they point somewhere else. Vercel
 * exposes the production domain as VERCEL_PROJECT_PRODUCTION_URL, which is
 * correct on preview deployments too — unlike VERCEL_URL, which is the
 * per-deployment hostname and would make previews claim to be canonical.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
