import { buildFixtures } from "../tests/fixtures";

/**
 * Ask the deployment whether it is the app, before spending anything on it.
 *
 * Without this, pointing the suite at a URL that answers with *something else*
 * costs four tests × a two-minute timeout and reports "waiting for
 * locator('input[type=file]')" — eight minutes to say nothing about what was
 * actually served. That is exactly how it failed the first time it ran: the
 * URL was a per-deployment address behind the platform's access protection,
 * so every page loaded fine and none of them was ours.
 *
 * One request, and the failure names the page.
 */
export default async function globalSetup() {
  await buildFixtures();

  const baseURL = process.env.DEPLOYMENT_URL!;
  const response = await fetch(baseURL, { redirect: "follow" });
  const body = await response.text();

  // The same marker `scripts/verify-rate-limit.sh` looks for: an attribute the
  // app renders, rather than page copy that a redesign would quietly change.
  if (response.status === 200 && body.includes('data-testid="drop-zone"')) return;

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
  throw new Error(
    [
      `${baseURL} did not serve the app.`,
      `  status:  ${response.status} ${response.statusText}`,
      `  final:   ${response.url}`,
      `  type:    ${response.headers.get("content-type") ?? "(none)"}`,
      `  title:   ${title ?? "(none)"}`,
      `  body:    ${body.replace(/\s+/g, " ").slice(0, 300)}`,
      "",
      "A per-deployment URL sits behind the platform's access protection and",
      "answers with a login page. The checks are meant for the address users",
      "are on, so point DEPLOYMENT_URL at the production domain.",
    ].join("\n"),
  );
}
