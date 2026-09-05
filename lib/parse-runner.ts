import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Runs a parse in a process of its own, with a time budget and a memory
 * ceiling it cannot exceed.
 *
 * ── Why not in the request path ──────────────────────────────────────────
 *
 * `exceljs` and `mammoth` do enough synchronous work that a runaway document
 * blocks the event loop. A `Promise.race` against a timer would return a
 * response while the parse carried on — still holding its memory, still
 * holding a concurrency slot, and now invisible. That is worse than no
 * timeout, which is why one was never added until there was somewhere to put
 * the work that could actually be stopped.
 *
 * ── Why a process rather than a thread ───────────────────────────────────
 *
 * A thread was the first version and it is cheaper. It cannot bound memory.
 * A worker's `resourceLimits` is accepted, reported back correctly, and then
 * ignored: measured with `maxOldGenerationSizeMb: 16`, the worker's heap
 * reached 2,217 MB — 138x — and was still running. A ceiling built on it
 * would be a number in the code that bounds nothing.
 *
 * A process started with `--max-old-space-size` genuinely dies at its limit.
 * Measured: 662 ms to hit a 128 MB ceiling, exiting on `SIGABRT` with V8's own
 * message on stderr, which is what makes a memory kill identifiable rather
 * than just another crash.
 *
 * The cost is real and was measured before choosing: `fork()` takes ~98 ms
 * against ~42 ms for a thread, so about **56 ms more per Office upload**, on
 * work that already takes 200 ms to 3 s.
 *
 * ── Measured here, not on the deployment ─────────────────────────────────
 *
 * Every number above comes from a container with 16 GB and no cgroup limit.
 * On a serverless platform the function has its own memory budget that this
 * child draws from, so the ceiling is a share of a share, and the spawn cost
 * on a cold instance is unmeasured. That was a known risk when this was
 * written, taken deliberately.
 */

/**
 * Never called. It exists so the deployment contains the parsers.
 *
 * The child is a plain `.mjs` spawned by path, which is what lets it be
 * stopped — and it means the bundler never reads it. `next.config.ts` copies
 * the file into the traced output, but copying a file is not the same as
 * following what it imports: `exceljs`, `mammoth` and `xlsx` are named only
 * inside it, so nothing told the tracer they were needed.
 *
 * The result was a deployment that shipped the child and none of its parsers.
 * Every Office upload failed, and — until the message was fixed — told the
 * user their file might be corrupt. Measured rather than reasoned: before this
 * function existed, `grep -rl node_modules/exceljs .next/server/**\/*.nft.json`
 * matched **zero** files.
 *
 * Dynamic imports in a module the tracer *does* read make it follow them, and
 * following them brings their transitive dependencies too, which is the part a
 * hand-written include list cannot get right. The environment check is what
 * stops the compiler folding this away as unreachable; `tests/tracing.spec.ts`
 * asserts the effect on the build output rather than trusting the trick.
 */
export async function parsersForTracing(): Promise<unknown[]> {
  if (process.env.NEVER_SET !== "1") return [];
  return Promise.all([
    import("exceljs"),
    import("mammoth"),
    import("xlsx"),
  ]);
}

/** A parse that has not finished by now is not going to. */
export const PARSE_TIMEOUT_MS = 8_000;

/**
 * The heap a single parse may use.
 *
 * Generous against what real files need — the fixtures here expand to about
 * 27 MB — and far below any plausible function size, so a legitimate document
 * never meets it and a hostile one meets it long before the platform's own
 * limit turns into a killed instance.
 */
export const PARSE_MEMORY_MB = 256;

export class ParseTimeoutError extends Error {}
export class ParseMemoryError extends Error {}

/**
 * The parser could not be *started*, or died without speaking.
 *
 * Distinct from `ParserError`, which is a parser reporting that it could not
 * read a file, because the two are opposite claims: one is about the file and
 * the other is about us. Collapsing them told a user their perfectly good
 * workbook might be corrupt — which is what the deployment did, in production,
 * for as long as nobody had checked.
 */
export class ParseUnavailableError extends Error {}

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

/** What the child sends back on success. */
export type WorkerResult =
  | { kind: "sheet"; sheets: { name: string; rows: string[][]; totalRows: number }[] }
  | { kind: "raw-html"; html: string };

/**
 * V8's own words when it gives up.
 *
 * Matched so a memory kill can be told apart from any other abnormal exit and
 * given a message that says what actually happened. Both spellings appear
 * depending on where the allocation failed.
 */
const OOM_SIGNATURE = /heap out of memory|Allocation failed|JavaScript heap/i;

/**
 * Resolved from the working directory rather than `import.meta.url`.
 *
 * The bundler rewrites module URLs, so a path derived from this file's own
 * location points into the bundle rather than at the child. `next.config.ts`
 * forces the file into the deployment's traced output so it is on disk beside
 * the server at runtime.
 */
const CHILD_PATH = join(process.cwd(), "lib", "parse-child.mjs");

/**
 * `timeoutMs` and `memoryMb` are parameters rather than constants read from
 * the environment.
 *
 * Both are properties of the call, and making them so means the suite can
 * drive the timeout and the ceiling directly instead of the code carrying
 * knobs whose only purpose is to be turned in tests.
 */
export function runParseInWorker(
  formatId: string,
  bytes: Uint8Array,
  limits: WorkerLimits,
  timeoutMs: number = PARSE_TIMEOUT_MS,
  memoryMb: number = PARSE_MEMORY_MB,
  /*
   * A parameter for one reason: "the child is not on disk" is the failure this
   * whole file's deployment risk is about — `next.config.ts` forces the file
   * into the traced output, and nothing imports it, so the directive failing
   * is silent. There is no other way to reach that path in a test, and it is
   * not hypothetical: it is what a broken deployment looks like.
   */
  childPath: string = CHILD_PATH,
): Promise<{ result: WorkerResult; notices: string[] }> {
  return new Promise((resolve, reject) => {
    /*
     * `spawn` rather than `fork`, and the script named in argv rather than as
     * the first argument.
     *
     * `fork(path)` reads to a bundler like a module reference: Turbopack
     * resolved the constant, tried to import it, and failed the build with
     * "server relative imports are not implemented yet". Passing the path as
     * an ordinary argument to the Node binary leaves nothing to analyse, and
     * the `ipc` entry in `stdio` gives back the channel `fork` would have set
     * up — `child.send` works exactly the same.
     */
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${memoryMb}`, childPath],
      {
        /*
         * Structured clone rather than the default JSON. A few megabytes of
         * file sent as JSON becomes a number-keyed object — enormous, slow,
         * and it does not survive the trip as a typed array at the far end.
         */
        serialization: "advanced",
        // stderr is piped because V8 announces an out-of-memory death there
        // and nowhere else; stdout is dropped because a parser has no business
        // writing to it.
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      // Bounded: a child in a crash loop could otherwise stream indefinitely
      // into the parent's memory, which is the failure being prevented.
      if (stderr.length < 8_192) stderr += chunk.toString();
    });

    let settled = false;
    /**
     * Every exit path goes through here.
     *
     * A child left running is the failure this exists to prevent, so the kill
     * is unconditional rather than conditional on which branch got here first.
     * `SIGKILL` because a parse that has to be stopped is not going to honour
     * anything politer, and the guard makes the `exit` that follows harmless
     * rather than a second settle racing the real reason.
     */
    const finish = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      act();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new ParseTimeoutError(`Parse exceeded ${timeoutMs}ms and was stopped`),
        ),
      );
    }, timeoutMs);

    child.on("message", (message: unknown) => {
      const reply = message as
        | { ok: true; result: WorkerResult; notices: string[] }
        | { ok: false; name: string; message: string };

      if (reply.ok) {
        finish(() => resolve({ result: reply.result, notices: reply.notices }));
      } else if (reply.name === "ParserUnavailable") {
        // The child could not load its parser. That is our deployment, not
        // their file, and it must not arrive as a `ParserError`.
        finish(() =>
          reject(new ParseUnavailableError(`Parser unavailable: ${reply.message}`)),
        );
      } else {
        finish(() => reject(new ParserError(reply.message, reply.name)));
      }
    });

    // Spawn refused outright: the binary, the path, or the platform.
    child.on("error", (error) =>
      finish(() =>
        reject(new ParseUnavailableError(`Could not start the parser: ${error.message}`)),
      ),
    );

    /*
     * The only place a memory kill can be recognised. The child dies without
     * replying, so without this the request would hang until the platform gave
     * up on it — and a generic "stopped unexpectedly" would tell the user
     * nothing about a file that is simply too large to open here.
     */
    child.on("exit", (code, signal) => {
      finish(() => {
        if (OOM_SIGNATURE.test(stderr)) {
          reject(
            new ParseMemoryError(
              `Parse exceeded ${memoryMb}MB and was stopped`,
            ),
          );
          return;
        }
        /*
         * Died without replying, and not for memory. A missing child file
         * looks exactly like this: node starts, cannot resolve the module,
         * writes to stderr and exits 1. So does a platform that refuses to let
         * a function spawn anything.
         */
        reject(
          new ParseUnavailableError(
            `Parse process stopped unexpectedly (code ${code}, signal ${signal})` +
              (stderr ? `: ${stderr.slice(0, 300)}` : ""),
          ),
        );
      });
    });

    child.send({ formatId, bytes, limits });
  });
}
