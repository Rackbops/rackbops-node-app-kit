/**
 * Minimal structured logger: one JSON line per record to stdout. Extracted from
 * `Rackbops/kenzen`'s `packages/server/src/log.ts` (originally copied from
 * `Rackbops/artifact-console`'s `packages/host/src/log.ts`), then hardened: an `Error` field
 * serializes as `{ name, message, stack }`, a BigInt as a string, `time`/`level`/`msg` always win
 * over a same-named field, and a field that cannot be serialized (a circular object) yields a
 * fallback line instead of a throw -- logging never crashes its caller. `child()` returns a
 * logger with extra bound fields. The sink and clock are injectable so tests can capture output
 * deterministically.
 */

export type LogLevel = "info" | "warn" | "error"

export type LogFields = Record<string, unknown>

export interface Logger {
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
}

export interface LoggerOptions {
  /** Sink for one serialized JSON line. Defaults to stdout. */
  write?: (line: string) => void
  /** Fields merged into every record (accumulated by `child()`). */
  bindings?: LogFields
  /** Clock, injectable for tests. */
  now?: () => Date
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => void process.stdout.write(`${line}\n`))
  const bindings = options.bindings ?? {}
  const now = options.now ?? (() => new Date())

  function emit(level: LogLevel, msg: string, fields?: LogFields): void {
    const time = now().toISOString()
    // The record's own keys are taken out of the caller's fields, so a field named `level` or
    // `msg` cannot relabel the record; time/level/msg stay first in the output.
    const { time: _t, level: _l, msg: _m, ...rest } = { ...bindings, ...fields }
    try {
      write(JSON.stringify({ time, level, msg, ...rest }, replacer))
    } catch (err) {
      write(
        JSON.stringify({
          time,
          level,
          msg,
          logError: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) =>
      createLogger({ write, now, bindings: { ...bindings, ...childBindings } }),
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (typeof value === "bigint") {
    return value.toString()
  }
  return value
}
