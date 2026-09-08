import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { migrate } from "./migrate.js"

const dirs: string[] = []

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "node-app-kit-migrations-"))
  dirs.push(dir)
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql)
  }
  return dir
}

function tables(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe("migrate", () => {
  it("applies pending migrations in order and reports the schema version", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({
      "0001_a.sql": "CREATE TABLE a(x);",
      "0002_b.sql": "CREATE TABLE b(y);",
    })
    expect(migrate(db, dir)).toBe(2)
    expect(tables(db)).toEqual(["a", "b"])
  })

  it("a second run applies zero migrations and reports the same version", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({ "0001_a.sql": "CREATE TABLE a(x);" })
    expect(migrate(db, dir)).toBe(1)
    // If it re-applied 0001, the CREATE TABLE would throw "table a already exists".
    expect(migrate(db, dir)).toBe(1)
  })

  it("a failing migration rolls the whole file back and leaves the version unchanged", () => {
    const db = new DatabaseSync(":memory:")
    // 'keep' is created and executed before the failing INSERT; a real rollback must undo it too.
    const dir = migrationsDir({
      "0001_x.sql": "CREATE TABLE keep(x);\nINSERT INTO does_not_exist VALUES(1);",
    })
    expect(() => migrate(db, dir)).toThrow(/0001_x\.sql/)
    expect(tables(db)).toEqual([])
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 })
  })

  it("ignores files that are not .sql", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({
      "0001_a.sql": "CREATE TABLE a(x);",
      "README.md": "hi",
      "notes.txt": "y",
    })
    expect(migrate(db, dir)).toBe(1)
  })

  it("a .sql file that is not NNNN_name.sql is a hard error, not a silent skip", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({ "1_bad.sql": "CREATE TABLE a(x);" })
    expect(() => migrate(db, dir)).toThrow(/invalid migration filename/)
  })

  // A version-0 file would be silently and permanently skipped otherwise: currentVersion()
  // defaults to 0 for a fresh database, so `version <= currentVersion(db)` is true forever.
  // Caught by an adversarial review (Tooling#478 K4-3) as a dormant trap inherited from
  // artifact-console's own migrate.ts.
  it("a migration numbered 0000 is a hard error, not a silently-forever-skipped migration", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({ "0000_zero.sql": "CREATE TABLE a(x);" })
    expect(() => migrate(db, dir)).toThrow(/invalid migration filename.*numbers start at 0001/)
  })

  it("a duplicate migration number is a hard error, not a silent skip", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({
      "0002_a.sql": "CREATE TABLE a(x);",
      "0002_b.sql": "CREATE TABLE b(y);",
    })
    expect(() => migrate(db, dir)).toThrow(/duplicate migration number/)
  })
})
