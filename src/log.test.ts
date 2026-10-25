import { describe, expect, it } from "vitest"
import { createLogger } from "./log.js"

describe("createLogger", () => {
  it("emits one JSON line per call with time, level, msg, and extra fields", () => {
    const lines: string[] = []
    const log = createLogger({
      write: (l) => lines.push(l),
      now: () => new Date("2026-01-01T00:00:00Z"),
    })

    log.info("hello", { port: 8686 })

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toEqual({
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      msg: "hello",
      port: 8686,
    })
  })

  it("emits warn and error at the right level", () => {
    const lines: string[] = []
    const log = createLogger({ write: (l) => lines.push(l) })

    log.warn("careful")
    log.error("broken")

    expect(JSON.parse(lines[0] as string).level).toBe("warn")
    expect(JSON.parse(lines[1] as string).level).toBe("error")
  })

  it("child() merges bound fields into every subsequent record, without mutating the parent", () => {
    const lines: string[] = []
    const parent = createLogger({ write: (l) => lines.push(l) })
    const child = parent.child({ requestId: "abc" })

    child.info("scoped")
    parent.info("unscoped")

    expect(JSON.parse(lines[0] as string)).toMatchObject({ msg: "scoped", requestId: "abc" })
    expect(JSON.parse(lines[1] as string).requestId).toBeUndefined()
  })

  it("fields passed per-call override same-named bindings", () => {
    const lines: string[] = []
    const log = createLogger({ write: (l) => lines.push(l), bindings: { source: "boot" } })

    log.info("x", { source: "override" })

    expect(JSON.parse(lines[0] as string).source).toBe("override")
  })
})

describe("logger hardening", () => {
  function capture() {
    const lines: string[] = []
    const log = createLogger({ write: (l) => lines.push(l), now: () => new Date(0) })
    return { lines, log }
  }

  it("serializes an Error field with its name, message and stack", () => {
    const { lines, log } = capture()
    log.error("save failed", { err: new TypeError("disk full") })
    const rec = JSON.parse(lines[0] as string)
    expect(rec.err.name).toBe("TypeError")
    expect(rec.err.message).toBe("disk full")
    expect(rec.err.stack).toContain("disk full")
  })

  it("a field or binding named level, msg or time cannot overwrite the record's own", () => {
    const { lines, log } = capture()
    log.child({ msg: "bound" }).info("real", { level: "debug", time: "x" })
    const rec = JSON.parse(lines[0] as string)
    expect(rec).toMatchObject({ level: "info", msg: "real", time: "1970-01-01T00:00:00.000Z" })
    expect(Object.keys(rec).slice(0, 3)).toEqual(["time", "level", "msg"])
  })

  it("a BigInt field is written as a string instead of throwing", () => {
    const { lines, log } = capture()
    log.info("n", { n: 12345678901234567890n })
    expect(JSON.parse(lines[0] as string).n).toBe("12345678901234567890")
  })

  it("a circular field neither throws nor drops the line", () => {
    const { lines, log } = capture()
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(() => log.warn("loop", { loop })).not.toThrow()
    const rec = JSON.parse(lines[0] as string)
    expect(rec).toMatchObject({ level: "warn", msg: "loop" })
    expect(rec.logError).toMatch(/circular/i)
    expect(rec.time).toBe("1970-01-01T00:00:00.000Z")
  })

  it("a throwing getter in the fields neither throws nor drops the line", () => {
    const { lines, log } = capture()
    const bad = Object.defineProperty({}, "k", {
      enumerable: true,
      get() {
        throw new Error("getter boom")
      },
    })
    expect(() => log.info("g", bad)).not.toThrow()
    expect(JSON.parse(lines[0] as string)).toEqual({
      time: "1970-01-01T00:00:00.000Z",
      level: "info",
      msg: "g",
      logError: "getter boom",
    })
  })

  it("the fallback itself cannot throw, even for a thrown non-Error with no string form", () => {
    const { lines, log } = capture()
    const field = {
      toJSON() {
        throw Object.create(null)
      },
    }
    expect(() => log.info("x", { field })).not.toThrow()
    expect(JSON.parse(lines[0] as string).logError).toBe("unserializable log field")
  })

  it("an Error keeps its cause, code and AggregateError members", () => {
    const { lines, log } = capture()
    const err = Object.assign(new Error("outer", { cause: new RangeError("inner") }), {
      code: "E_X",
    })
    log.error("e", { err, agg: new AggregateError([new Error("a")], "many") })
    const rec = JSON.parse(lines[0] as string)
    expect(rec.err).toMatchObject({
      message: "outer",
      code: "E_X",
      cause: { name: "RangeError", message: "inner" },
    })
    expect(rec.agg.errors[0].message).toBe("a")
  })

  it("child() keeps the parent's bindings and the fallback line keeps its key order", () => {
    const { lines, log } = capture()
    const child = log.child({ a: 1 }).child({ b: 2 })
    child.info("ok")
    expect(JSON.parse(lines[0] as string)).toMatchObject({ a: 1, b: 2 })
    const loop: Record<string, unknown> = {}
    loop.self = loop
    child.info("bad", { loop })
    expect(Object.keys(JSON.parse(lines[1] as string))).toEqual([
      "time",
      "level",
      "msg",
      "logError",
    ])
  })

  it("a nested Error in an array serializes too", () => {
    const { lines, log } = capture()
    log.warn("n", { errs: [new Error("x")] })
    expect(JSON.parse(lines[0] as string).errs[0].message).toBe("x")
  })
})
