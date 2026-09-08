import { DatabaseSync } from "node:sqlite"

/**
 * Opens a SQLite state database (Node's built-in `node:sqlite`, zero external DB dependency).
 * Extracted from `Rackbops/kenzen`'s `packages/server/src/db.ts` (originally copied from
 * `Rackbops/artifact-console`'s `packages/host/src/db.ts`), already fully generic -- no change
 * from the source. WAL for concurrent reads during a write; foreign keys on. This is the
 * database I/O edge: `migrate.ts` and `state.ts` take the handle it returns rather than opening
 * their own, so they unit-test against a `:memory:` database.
 */
export function openDatabase(dbFile: string): DatabaseSync {
  const db = new DatabaseSync(dbFile)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  return db
}
