import { join } from "node:path";
import { Worker } from "node:worker_threads";

/**
 * Runs a parse in a worker thread, with a wall-clock budget it cannot exceed.
 *
 * ── Why a thread rather than a race ──────────────────────────────────────
 *
 * `exceljs` and `mammoth` do enough synchronous work that a runaway document
 * blocks the event loop. A `Promise.race` against a timer would return a
 * response while the parse carried on — still holding its memory, still
 * holding a concurrency slot, and now invisible. That is worse than no
 * timeout, which is why one was never added until there was somewhere to put
 * the work that could actually be stopped.
 *
 * `terminate()` can stop it. Measured on this runtime: a worker running
 * `for(;;){}` — a loop that never yields — is dead 4 ms after the call.
 *
 * ── What this does not do ────────────────────────────────────────────────
 *
 * It does not bound memory. `resourceLimits` looks like the answer and is not:
 * on Node 22 the worker accepts the option, reports it back correctly, and
 * ignores it. Measured with `maxOldGenerationSizeMb: 16`, the worker's heap
 * reached 2,217 MB — 138x the limit — and was still running when the test
 * gave up. Setting it here would put a number in the code that means nothing.
 * See the issue for the full measurements.
 *
 * ── Why no `server-only` here ────────────────────────────────────────────
 *
 * It would be redundant and it would make this module untestable. Redundant
 * because `node:worker_threads` cannot resolve in a browser bundle at all — an
 * accidental client import fails the build either way — and because
 * `lib/adapters/server.ts`, the only thing in the app that reaches this,
 * carries the guard where it matters, keeping `exceljs` out of the client
 * bundle. Untestable because the guard throws in a plain Node process, and the
 * timeout path has no other way to be driven.
 */

/** A parse that has not finished by now is not going to. */
export const PARSE_TIMEOUT_MS = 8_000;

export class ParseTimeoutError extends Error {}

/** The failure a parser reports for itself, carried back rather than thrown. */
export class ParserError extends Error {
  constructor(
    message: string,
    readonly parserName: string,
  ) {
    super(message);
  }
}

export interface WorkerLimits {
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxSheets: number;
  maxHtmlBytes: number;
}

/** What the worker sends back on success. */
export type WorkerResult =
  | { kind: "sheet"; sheets: { name: string; rows: string[][]; totalRows: number }[] }
  | { kind: "raw-html"; html: string };

/**
 * Resolved from the working directory rather than `import.meta.url`.
 *
 * The bundler rewrites module URLs, so a path derived from this file's own
 * location points into the bundle rather than at the worker. `next.config.ts`
 * forces the file into the deployment's traced output so it is on disk beside
 * the server at runtime.
 */
const WORKER_PATH = join(process.cwd(), "lib", "parse-worker.mjs");

/**
 * `timeoutMs` is a parameter rather than a constant read from the environment.
 *
 * The budget is a property of the call, and making it one means the suite can
 * drive the timeout path directly instead of the code carrying a knob whose
 * only purpose is to be turned in tests.
 */
export function runParseInWorker(
  formatId: string,
  bytes: Uint8Array,
  limits: WorkerLimits,
  timeoutMs: number = PARSE_TIMEOUT_MS,
): Promise<{ result: WorkerResult; notices: string[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { formatId, bytes, limits },
    });

    let settled = false;
    /**
     * Every exit path goes through here.
     *
     * A worker left running is the failure this whole change exists to
     * prevent, so termination is unconditional rather than conditional on
     * which branch got here first — and the guard makes a late `exit` after a
     * timeout harmless rather than a second settle.
     */
    const finish = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      act();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new ParseTimeoutError(
            `Parse exceeded ${timeoutMs}ms and was stopped`,
          ),
        ),
      );
    }, timeoutMs);

    worker.on("message", (message) => {
      if (message.ok) {
        finish(() =>
          resolve({ result: message.result, notices: message.notices }),
        );
      } else {
        finish(() => reject(new ParserError(message.message, message.name)));
      }
    });

    // A worker that dies without reporting — an out-of-memory kill, a failure
    // to load the file at all — must still settle, or the request hangs until
    // the platform gives up on it.
    worker.on("error", (error) => finish(() => reject(error)));
    worker.on("exit", (code) =>
      finish(() =>
        reject(new Error(`Parse worker stopped unexpectedly (code ${code})`)),
      ),
    );
  });
}
