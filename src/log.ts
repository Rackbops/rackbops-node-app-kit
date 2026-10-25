/**
 * Minimal structured logger: one JSON line per record to stdout. Extracted from
 * `Rackbops/kenzen`'s `packages/server/src/log.ts` (originally copied from
 * `Rackbops/artifact-console`'s `packages/host/src/log.ts`), then hardened: an `Error` field
 * serializes as its scalar own props (`code`, `errno`, ...) plus `name`, `message`, `stack` and
 * `cause` (object-valued props are left out: they often hold credentials), a BigInt as a string, `time`/`level`/`msg` always win
 * over a same-named field, and a field that cannot be serialized (a circular object, a throwing getter) yields a
 * fallback line with only time/level/msg/logError instead of a throw -- serializing a record never throws (a failing `write` sink still propagates). `child()` returns a
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
    write(serialize(time, level, msg, bindings, fields))
  }

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) =>
      createLogger({ write, now, bindings: { ...bindings, ...childBindings } }),
  }
}

function serialize(
  time: string,
  level: LogLevel,
  msg: string,
  bindings: LogFields,
  callFields?: LogFields,
): string {
  try {
    // The record's own keys are taken out of the caller's fields, so a field named `level` or
    // `msg` cannot relabel the record; time/level/msg stay first in the output.
    const { time: _t, level: _l, msg: _m, ...fields } = { ...bindings, ...callFields }
    return JSON.stringify({ time, level, msg, ...fields }, makeReplacer())
  } catch (err) {
    // Only the record's own keys survive: one unserializable field costs the line its fields,
    // never the line itself.
    return JSON.stringify({ time, level, msg, logError: describe(err) })
  }
}

function describe(err: unknown): string {
  try {
    return err instanceof Error ? err.message : String(err)
  } catch {
    return "unserializable log field"
  }
}

function makeReplacer(): (key: string, value: unknown) => unknown {
  const seenErrors = new WeakSet<Error>()
  return (_key, value) => {
    if (value instanceof Error) {
      // An Error whose `cause` chain loops back would otherwise expand forever.
      if (seenErrors.has(value)) {
        return "[circular error]"
      }
      seenErrors.add(value)
      const extra = value instanceof AggregateError ? { errors: value.errors } : {}
      // Own enumerable props that are plain scalars (code, errno, syscall, status) are kept;
      // object-valued ones (an HTTP client's request config and response body) are not, since
      // they routinely carry credentials. `name`, `message`, `stack` and `cause` are
      // non-enumerable on Error, so they are added explicitly.
      const scalars = Object.fromEntries(
        Object.entries(value).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)),
      )
      return {
        ...scalars,
        ...extra,
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(value.cause === undefined ? {} : { cause: value.cause }),
      }
    }
    return typeof value === "bigint" ? value.toString() : value
  }
}
