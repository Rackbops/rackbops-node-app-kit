import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"

/**
 * Applies numbered `.sql` migrations at boot. Extracted from `Rackbops/kenzen`'s
 * `packages/server/src/migrate.ts` (originally copied from `Rackbops/artifact-console`'s
 * `packages/host/src/migrate.ts`), then hardened (see the list below). Each `NNNN_name.sql`
 * above the database's current `PRAGMA user_version` runs in its own transaction, then bumps
 * `user_version` to its number. Idempotent: a second call applies nothing and returns the same
 * version. The schema version is `user_version` itself, so there is no separate bookkeeping
 * table to drift.
 *
 * Every `.sql` file in the dir must match `NNNN_name.sql` with a unique number, and the numbers
 * must run 1..N with no gap, or migrate throws -- a mistyped, duplicate or missing number is a
 * loud boot error, never a silently-skipped migration. It also throws when the database is
 * already past the highest migration on disk (an older build against a newer schema). See
 * `docs/migrations-authoring-contract.md` for the full authoring contract a consumer's own
 * migrations directory must follow.
 *
 * Each migration runs with `PRAGMA foreign_keys = OFF` (restored afterwards), because SQLite's
 * documented table-rebuild procedure (create new, copy, drop old, rename) otherwise cascades
 * `ON DELETE CASCADE` through every child table when the old table is dropped; a
 * `PRAGMA foreign_key_check` before COMMIT then rejects a migration that leaves a dangling
 * reference. The transaction is `BEGIN IMMEDIATE` and the version is re-read inside it, so two
 * processes migrating one file at once apply each migration exactly once.
 */
export function migrate(db: DatabaseSync, migrationsDir: string): number {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort() // zero-padded numeric prefixes sort correctly as strings

  const seen = new Set<number>()
  const numbered: { file: string; version: number }[] = []
  for (const file of files) {
    if (!/^\d{4}_.*\.sql$/.test(file)) {
      throw new Error(`invalid migration filename: ${file} (expected NNNN_name.sql)`)
    }
    const version = Number.parseInt(file.slice(0, 4), 10)
    // version 0 can never apply: currentVersion() defaults to 0 for a fresh database, and the
    // skip check below is `version <= currentVersion(db)` -- 0000_*.sql would be silently and
    // permanently skipped on every boot, forever, with no error. An adversarial review on
    // Kenzen's K4-3 (Tooling#478) found this dormant trap (inherited from artifact-console's own
    // migrate.ts, which has the identical boundary condition); numbering starts at 1.
    if (version < 1) {
      throw new Error(`invalid migration filename: ${file} (numbers start at 0001, not 0000)`)
    }
    if (seen.has(version)) {
      throw new Error(`duplicate migration number ${file.slice(0, 4)}: ${file}`)
    }
    seen.add(version)
    numbered.push({ file, version })
  }

  // Numbers are unique and ascending here, so any gap shows as a number above its position.
  // A migration that lands late under a lower number than the database's version would
  // otherwise be skipped on every boot with no error.
  for (const [i, { file, version }] of numbered.entries()) {
    if (version !== i + 1) {
      throw new Error(
        `missing migration number ${pad(i + 1)}: found ${file} next (numbers must run 0001..NNNN with no gap)`,
      )
    }
  }

  const highest = numbered.length
  const dbVersion = currentVersion(db)
  if (dbVersion > highest) {
    throw new Error(
      `database is at schema version ${dbVersion}, but this build only knows migrations up to ${highest}`,
    )
  }

  for (const { file, version } of numbered) {
    if (version <= dbVersion) {
      continue
    }
    applyMigration(db, file, readFileSync(join(migrationsDir, file), "utf8"), version)
  }

  return currentVersion(db)
}

function pad(n: number): string {
  return String(n).padStart(4, "0")
}

function applyMigration(db: DatabaseSync, file: string, sql: string, version: number): void {
  // PRAGMA foreign_keys is a no-op inside a transaction, so it is set before BEGIN and put back
  // in the finally.
  const foreignKeys = foreignKeysSetting(db)
  db.exec("PRAGMA foreign_keys = OFF")
  try {
    try {
      db.exec("BEGIN IMMEDIATE")
      // Another process may have applied this migration since migrate() read the version; the
      // write lock is held now, so this read is final.
      if (currentVersion(db) >= version) {
        db.exec("ROLLBACK")
        return
      }
      db.exec(sql)
      // `version` is a validated integer from the filename, so this interpolation is safe
      // (PRAGMA does not accept a bound parameter).
      db.exec(`PRAGMA user_version = ${version}`)
      const dangling = db.prepare("PRAGMA foreign_key_check").all() as { table: string }[]
      if (dangling.length > 0) {
        throw new Error(
          `${dangling.length} foreign key violation(s) after the migration, first in table ${dangling[0]?.table}`,
        )
      }
      db.exec("COMMIT")
    } catch (err) {
      // SQLite already ended the transaction for some errors (RAISE(ROLLBACK), ON CONFLICT
      // ROLLBACK, disk full); rolling back again would throw and hide the real error.
      if (db.isTransaction) {
        db.exec("ROLLBACK")
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`migration ${file} failed: ${detail}`)
    }
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeys}`)
  }
}

function foreignKeysSetting(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number } | undefined
  return row?.foreign_keys ?? 0
}

function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined
  return row?.user_version ?? 0
}
