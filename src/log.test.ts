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
