import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"

/**
 * Applies numbered `.sql` migrations at boot. Extracted from `Rackbops/kenzen`'s
 * `packages/server/src/migrate.ts` (originally copied from `Rackbops/artifact-console`'s
 * `packages/host/src/migrate.ts`), already fully generic -- no change from the source. Each
 * `NNNN_name.sql` above the database's current `PRAGMA user_version` runs in its own
 * transaction, then bumps `user_version` to its number. Idempotent: a second call applies
 * nothing and returns the same version. The schema version is `user_version` itself, so there
 * is no separate bookkeeping table to drift.
 *
 * Every `.sql` file in the dir must match `NNNN_name.sql` with a unique number, or migrate
 * throws -- a mistyped or duplicate number is a loud boot error, never a silently-skipped
 * migration. See `docs/migrations-authoring-contract.md` for the full authoring contract a
 * consumer's own migrations directory must follow.
 */
export function migrate(db: DatabaseSync, migrationsDir: string): number {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort() // zero-padded numeric prefixes sort correctly as strings

  const seen = new Set<number>()
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
    if (version <= currentVersion(db)) {
      continue
    }
    applyMigration(db, file, readFileSync(join(migrationsDir, file), "utf8"), version)
  }

  return currentVersion(db)
}

function applyMigration(db: DatabaseSync, file: string, sql: string, version: number): void {
  db.exec("BEGIN")
  try {
    db.exec(sql)
    // `version` is a validated integer from the filename, so this interpolation is safe
    // (PRAGMA does not accept a bound parameter).
    db.exec(`PRAGMA user_version = ${version}`)
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`migration ${file} failed: ${detail}`)
  }
}

function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined
  return row?.user_version ?? 0
}
