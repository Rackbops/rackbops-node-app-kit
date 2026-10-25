import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { openDatabase } from "./db.js"
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

describe("migrate hardening", () => {
  function countRows(db: DatabaseSync, table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  }

  const parentChild =
    "CREATE TABLE parent(id INTEGER PRIMARY KEY, name TEXT);\n" +
    "CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);\n" +
    "INSERT INTO parent VALUES(1,'a'),(2,'b');\n" +
    "INSERT INTO child VALUES(1,1),(2,1),(3,2);"

  // SQLite's documented table-rebuild procedure.
  const rebuildParent =
    "CREATE TABLE parent_new(id INTEGER PRIMARY KEY, name TEXT, extra TEXT DEFAULT 'x');\n" +
    "INSERT INTO parent_new(id, name) SELECT id, name FROM parent;\n" +
    "DROP TABLE parent;\n" +
    "ALTER TABLE parent_new RENAME TO parent;"

  it("a table-rebuild migration keeps the cascading child rows and restores foreign_keys", () => {
    const db = openDatabase(":memory:")
    migrate(db, migrationsDir({ "0001_a.sql": parentChild }))
    expect(countRows(db, "child")).toBe(3)

    migrate(db, migrationsDir({ "0001_a.sql": parentChild, "0002_rebuild.sql": rebuildParent }))
    expect(countRows(db, "child")).toBe(3)
    expect(countRows(db, "parent")).toBe(2)
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
  })

  it("a migration that leaves a dangling foreign key is rejected and rolled back", () => {
    const db = openDatabase(":memory:")
    const first = { "0001_a.sql": parentChild }
    migrate(db, migrationsDir(first))
    const dir = migrationsDir({ ...first, "0002_bad.sql": "INSERT INTO child VALUES(9, 99);" })
    expect(() => migrate(db, dir)).toThrow(
      /0002_bad\.sql.*foreign key violations: 1 after the migration, 0 before/,
    )
    expect(countRows(db, "child")).toBe(3)
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 })
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
  })

  it("a foreign key violation that predates the migration does not block it", () => {
    const db = openDatabase(":memory:")
    migrate(db, migrationsDir({ "0001_a.sql": parentChild }))
    db.exec("PRAGMA foreign_keys = OFF")
    db.exec("INSERT INTO child VALUES(50, 999)")
    db.exec("PRAGMA foreign_keys = ON")
    const dir = migrationsDir({ "0001_a.sql": parentChild, "0002_z.sql": "CREATE TABLE z(x);" })
    expect(migrate(db, dir)).toBe(2)
  })

  it("refuses to run inside a transaction the caller opened, and leaves it open", () => {
    const db = openDatabase(":memory:")
    db.exec("BEGIN")
    db.exec("CREATE TABLE mine(x)")
    expect(() => migrate(db, migrationsDir({ "0001_a.sql": "CREATE TABLE a(x);" }))).toThrow(
      /open transaction/,
    )
    expect(db.isTransaction).toBe(true)
    db.exec("COMMIT")
    expect(tables(db)).toEqual(["mine"])
  })

  it("a foreign_keys setting of OFF stays OFF afterwards", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false })
    migrate(db, migrationsDir({ "0001_a.sql": "CREATE TABLE a(x);" }))
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 })
  })

  it("a gap in the numbers is a hard error naming the missing number", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({
      "0001_a.sql": "CREATE TABLE a(x);",
      "0002_b.sql": "CREATE TABLE b(x);",
      "0004_d.sql": "CREATE TABLE d(x);",
    })
    expect(() => migrate(db, dir)).toThrow(/missing migration number 0003/)
    expect(tables(db)).toEqual([])
  })

  it("a late lower-numbered migration cannot be skipped on a database already past it", () => {
    const db = new DatabaseSync(":memory:")
    migrate(db, migrationsDir({ "0001_a.sql": "CREATE TABLE a(x);" }))
    db.exec("PRAGMA user_version = 4")
    const dir = migrationsDir({
      "0001_a.sql": "CREATE TABLE a(x);",
      "0003_c.sql": "CREATE TABLE c(x);",
      "0004_d.sql": "CREATE TABLE d(x);",
    })
    expect(() => migrate(db, dir)).toThrow(/missing migration number 0002/)
  })

  it("throws when the database is newer than the highest migration on disk", () => {
    const db = new DatabaseSync(":memory:")
    const all = {
      "0001_a.sql": "CREATE TABLE a(x);",
      "0002_b.sql": "CREATE TABLE b(x);",
      "0003_c.sql": "CREATE TABLE c(x);",
      "0004_d.sql": "CREATE TABLE d(x);",
    }
    expect(migrate(db, migrationsDir(all))).toBe(4)
    const { "0004_d.sql": _newest, ...older } = all
    expect(() => migrate(db, migrationsDir(older))).toThrow(/at schema version 4.*up to 3/)
  })

  it("a failure SQLite already rolled back (RAISE(ROLLBACK)) still names the file and cause", () => {
    const db = new DatabaseSync(":memory:")
    const dir = migrationsDir({
      "0001_trig.sql":
        "CREATE TABLE t(x);\n" +
        "CREATE TRIGGER trg BEFORE INSERT ON t BEGIN SELECT RAISE(ROLLBACK, 'boom'); END;\n" +
        "INSERT INTO t VALUES(1);",
    })
    expect(() => migrate(db, dir)).toThrow(/0001_trig\.sql.*boom/)
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 })
  })

  it("applies a migration once when another process applied it after the version was read", () => {
    const dbFile = join(mkdtempSync(join(tmpdir(), "node-app-kit-race-")), "state.db")
    dirs.push(dirname(dbFile))
    const files = {
      "0001_t.sql": "CREATE TABLE t(x);",
      "0002_row.sql": "INSERT INTO t VALUES(1);",
    }
    const dir = migrationsDir(files)
    const first = openDatabase(dbFile)
    migrate(first, migrationsDir({ "0001_t.sql": files["0001_t.sql"] }))
    const other = openDatabase(dbFile)

    // `first` reads user_version = 1; before it can BEGIN, `other` migrates to 2.
    let raced = false
    const stale = new Proxy(first, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop !== "prepare" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value
        }
        return (sql: string) => {
          const stmt = target.prepare(sql)
          if (!raced && sql === "PRAGMA user_version") {
            const read = stmt.get() as { user_version: number }
            raced = true
            migrate(other, dir)
            return { get: () => read }
          }
          return stmt
        }
      },
    })

    expect(migrate(stale, dir)).toBe(2)
    expect(raced).toBe(true)
    expect(countRows(first, "t")).toBe(1)
  })
})
