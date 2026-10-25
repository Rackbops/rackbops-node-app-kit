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
  })
})
