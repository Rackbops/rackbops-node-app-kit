import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const dirs: string[] = []
const silent = createLogger({ write: () => {} })

function tempDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "node-app-kit-state-"))
  dirs.push(dir)
  return join(dir, "sub", "app.db") // the 'sub' segment exercises mkdir -p on a fresh volume
}

function tempMigrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "node-app-kit-state-migrations-"))
  dirs.push(dir)
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql)
  }
  return dir
}

const oneMigration = { "0001_init.sql": "CREATE TABLE widgets(id INTEGER PRIMARY KEY);" }

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe("openState", () => {
  it("creates the db, migrates, and a re-open applies zero migrations", () => {
    const dbFile = tempDbFile()
    const migrationsDir = tempMigrationsDir(oneMigration)

    const first = openState({ dbFile, migrationsDir, log: silent })
    expect(first.schemaVersion).toBe(1)
    expect(existsSync(dbFile)).toBe(true)
    first.db.close()

    const second = openState({ dbFile, migrationsDir, log: silent })
    expect(second.schemaVersion).toBe(1)
    second.db.close()
  })

  it("a real-file database uses WAL and enforces foreign keys", () => {
    const state = openState({
      dbFile: tempDbFile(),
      migrationsDir: tempMigrationsDir(oneMigration),
      log: silent,
    })
    const journal = state.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    const fk = state.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }
    expect(journal.journal_mode).toBe("wal")
    expect(fk.foreign_keys).toBe(1)
    state.db.close()
  })

  it("logs 'state ready' with the schema version", () => {
    const lines: string[] = []
    const log = createLogger({ write: (l) => lines.push(l) })
    const state = openState({
      dbFile: ":memory:",
      migrationsDir: tempMigrationsDir(oneMigration),
      log,
    })
    const record = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => r.msg === "state ready")
    expect(record).toBeDefined()
    expect(record?.schemaVersion).toBe(state.schemaVersion)
    state.db.close()
  })

  it("applies whatever migrations dir it's given, in order -- proves it's not tied to any one app's schema", () => {
    const state = openState({
      dbFile: ":memory:",
      migrationsDir: tempMigrationsDir({
        "0001_a.sql": "CREATE TABLE a(x);",
        "0002_b.sql": "CREATE TABLE b(y);",
      }),
      log: silent,
    })
    const tables = state.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(["a", "b"])
    expect(state.schemaVersion).toBe(2)
    state.db.close()
  })
})
