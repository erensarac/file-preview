#!/usr/bin/env bash
#
# Checks that the deployment's rate-limit rules actually do what they claim.
#
# ── Why this is a script and not a spec ──────────────────────────────────────
#
# The rules live in Vercel's firewall, in front of the application. Nothing in
# the repository configures them and nothing in the suite can reach them: the
# Playwright run drives a local server that the firewall never sees. So the one
# control that stands between the upload action and a machine pointed at it is
# the one thing CI cannot cover. This is how it gets covered instead — by hand,
# or from the `verify-deployment` workflow, against the real origin.
#
# ── What it asserts ──────────────────────────────────────────────────────────
#
# A rate limit can fail in two directions, and only one of them is obvious:
#
#   too loose  — the burst is never refused, and the rule protects nothing.
#   too tight  — everything is refused, including ordinary browsing, and the
#                site is broken for everyone while looking fine on a graph.
#
# The second is why the first thing here is a negative control. A rule that
# blocks every request would sail through a test that only counted 403s, so
# plain navigation is measured first and any refusal there fails the run.
#
# It also checks that the limit *lifts*. A block that never expires is not a
# rate limit, it is an outage, and the difference is only visible after the
# window has passed.
#
# Usage:
#   scripts/verify-rate-limit.sh https://file-preview.vercel.app [upload/min] [telemetry/min]

set -uo pipefail

BASE="${1:?usage: scripts/verify-rate-limit.sh https://your-domain [upload-limit] [telemetry-limit]}"
BASE="${BASE%/}"
UPLOAD_LIMIT="${2:-30}"
# Both default to the same number because one rule covers both endpoints. The
# plan allows a single custom rule, so uploads and failure reports share a
# counter — see the README. These defaults describe the rule as deployed; pass
# arguments when checking something else.
TELEMETRY_LIMIT="${3:-30}"

# The window every Vercel rate-limit rule is configured over here. The recovery
# check waits it out, so it has to match the rule or the wait proves nothing.
# Read off the rule in the dashboard, not chosen here. Step 4 sleeps this out
# to prove the limit lifts, so a mismatch is silent and wrong in the worrying
# direction: against a 300s rule this waits 70 seconds, sees the refusal that
# is still correct, and reports a permanent block that does not exist.
WINDOW_SECONDS=60

failures=0
fail() { printf '  FAIL  %s\n' "$*"; failures=$((failures + 1)); }
pass() { printf '  ok    %s\n' "$*"; }

# A shaped upload: the request the firewall rule is meant to recognise. Content
# type and method are what the rule matches on — the body only has to be small
# and well-formed enough that nothing rejects it before the rule is consulted.
MULTIPART=$'------x\r\nContent-Disposition: form-data; name="file"; filename="t.xlsx"\r\n\r\nx\r\n------x--\r\n'
export BASE MULTIPART

# Every request prints exactly one status code and never fails the script: a
# connection that dies reports 000, which is a result worth seeing rather than
# an error worth aborting on.
get_once() {
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 "$BASE/" || echo 000
}
post_upload() {
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 -X POST \
    -H 'Content-Type: multipart/form-data; boundary=----x' \
    --data-binary "$MULTIPART" "$BASE/" || echo 000
}
post_telemetry() {
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 -X POST \
    -H 'Content-Type: text/plain;charset=UTF-8' \
    --data '[{}]' "$BASE/" || echo 000
}
export -f get_once post_upload post_telemetry

# Sent in parallel on purpose. A rate limit is requests *per window*, so a
# sequential loop slow enough to spread past the window would stay under the
# limit however many requests it sent — and would report "not enforced" about a
# rule that works.
burst() {
  local count=$1 fn=$2
  # `-n 1` and no replacement string: an `-I` placeholder is substituted
  # everywhere it appears, including inside the function name being called
  # ("get_once" became "get1once", every request failed, and the script blamed
  # the firewall). The number lands harmlessly in $0 instead.
  seq 1 "$count" | xargs -P 8 -n 1 bash -c "$fn"
}

# Prints "200 x37, 403 x8" — the shape of a run in one line, so a log that is
# read six months from now still says what happened.
tally() { sort | uniq -c | sort -rn | awk '{printf "%s x%s, ", $2, $1}' | sed 's/, $//'; }
# `|| true` because `grep -c` exits 1 on a count of zero. Under `pipefail`
# that would abort the run at exactly the moment there is a legitimate zero to
# report — nothing refused, which is a finding rather than an error.
count_of() { grep -c "^$1\$" || true; }

printf '\nVerifying rate limits on %s\n' "$BASE"
printf 'Configured: uploads %s/%ss, telemetry %s/%ss\n\n' \
  "$UPLOAD_LIMIT" "$WINDOW_SECONDS" "$TELEMETRY_LIMIT" "$WINDOW_SECONDS"

# ─────────────────────────────────────────────────────────────────────────────
printf '1. Negative control — ordinary navigation must not be limited\n'
control=$(burst 25 get_once)
printf '   %s\n' "$(printf '%s\n' "$control" | tally)"
control_blocked=$(printf '%s\n' "$control" | count_of 403)
control_ok=$(printf '%s\n' "$control" | count_of 200)

if [ "$control_blocked" -gt 0 ]; then
  fail "$control_blocked of 25 page loads were refused — a rule is matching normal traffic"
elif [ "$control_ok" -lt 25 ]; then
  fail "only $control_ok of 25 page loads succeeded — the origin is not healthy, later results mean nothing"
else
  pass 'browsing is untouched'
fi

# ─────────────────────────────────────────────────────────────────────────────
printf '\n2. Upload rule — a burst of %s shaped POSTs must start being refused\n' \
  $((UPLOAD_LIMIT * 3 / 2))
uploads=$(burst $((UPLOAD_LIMIT * 3 / 2)) post_upload)
printf '   %s\n' "$(printf '%s\n' "$uploads" | tally)"
upload_blocked=$(printf '%s\n' "$uploads" | count_of 403)

if [ "$upload_blocked" -eq 0 ]; then
  fail 'nothing was refused — the upload rule is not matching this request shape'
else
  pass "$upload_blocked refused"
fi

# ─────────────────────────────────────────────────────────────────────────────
# A 403 from the application would look identical in a status column, and the
# two mean opposite things: one is the rule working, the other is the rule
# absent and something else refusing. The response itself is the only place
# that difference is visible.
printf '\n3. The refusal comes from the firewall, not from the application\n'
# `mktemp` rather than a fixed path: if the request writes nothing — refused
# connection, timeout — a fixed path is still read, and the step reports on
# whatever a previous run left there. That fails open, which is the one
# direction a check must not fail.
body=$(mktemp)
trap 'rm -f "$body"' EXIT
headers=$(curl -sS -D- -o "$body" --max-time 20 -X POST \
  -H 'Content-Type: multipart/form-data; boundary=----x' \
  --data-binary "$MULTIPART" "$BASE/" 2>/dev/null || true)
printf '%s\n' "$headers" | grep -iE '^(HTTP/|x-vercel|retry-after|server|cache-control)' | sed 's/^/   /'

if printf '%s\n' "$headers" | grep -qi '^HTTP/[0-9.]* 403'; then
  # The test id, not the visible copy. "Drop a file here" is one rewording
  # away from never matching again, and not matching is the branch that
  # passes — so a copy edit would quietly turn this into a check that always
  # agrees with us.
  if grep -q 'data-testid="drop-zone"' "$body"; then
    fail 'the 403 body is our own page — this is the app answering, not the firewall'
  else
    pass 'refused before the application was reached'
  fi
else
  printf '   (not currently blocked — the window may have lapsed between steps)\n'
fi

# ─────────────────────────────────────────────────────────────────────────────
# The assertion that separates a rate limit from an outage.
printf '\n4. The limit lifts — waiting out the %ss window\n' "$WINDOW_SECONDS"
sleep $((WINDOW_SECONDS + 10))
recovered=$(post_upload)
printf '   after the window: %s\n' "$recovered"
if [ "$recovered" = "403" ]; then
  fail 'still refused a full window later — this is a block, not a rate limit'
else
  pass 'traffic is allowed again'
fi

# ─────────────────────────────────────────────────────────────────────────────
printf '\n5. Telemetry rule — %s shaped POSTs must start being refused\n' \
  $((TELEMETRY_LIMIT * 13 / 10))
telemetry=$(burst $((TELEMETRY_LIMIT * 13 / 10)) post_telemetry)
printf '   %s\n' "$(printf '%s\n' "$telemetry" | tally)"
telemetry_blocked=$(printf '%s\n' "$telemetry" | count_of 403)

if [ "$telemetry_blocked" -eq 0 ]; then
  fail 'nothing was refused — the telemetry rule is not matching this request shape'
else
  pass "$telemetry_blocked refused"
fi

printf '\n'
if [ "$failures" -gt 0 ]; then
  printf '%s check(s) failed.\n' "$failures"
  exit 1
fi
printf 'All checks passed.\n'
