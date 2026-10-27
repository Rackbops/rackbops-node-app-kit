import { describe, expect, it } from "vitest"
import { openDatabase } from "./db.js"

describe("openDatabase", () => {
  it("waits up to 5 s for a lock and enforces foreign keys", () => {
    const db = openDatabase(":memory:")
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 })
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
  })
})
