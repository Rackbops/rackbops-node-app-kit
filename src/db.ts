import { DatabaseSync } from "node:sqlite"

/**
 * Opens a SQLite state database (Node's built-in `node:sqlite`, zero external DB dependency).
 * Extracted from `Rackbops/kenzen`'s `packages/server/src/db.ts` (originally copied from
 * `Rackbops/artifact-console`'s `packages/host/src/db.ts`), already fully generic. WAL for
 * concurrent reads during a write; foreign keys on; a 5 s busy timeout and a short retry of the
 * WAL switch (both added here) so a second process (a CLI next to the server) waits for a lock
 * instead of failing at once, including when both open a fresh file together. This is the
 * database I/O edge: `migrate.ts` and `state.ts` take the handle it returns rather than opening
 * their own, so they unit-test against a `:memory:` database.
 */
export function openDatabase(dbFile: string): DatabaseSync {
  const db = new DatabaseSync(dbFile)
  db.exec("PRAGMA busy_timeout = 5000")
  enableWal(db)
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

/**
 * Switching a fresh file to WAL needs a lock that SQLite's busy handler does not always wait for
 * when another process is doing the same, so `database is locked` can surface despite
 * `busy_timeout`. The loser of that race only has to try again, so retry briefly.
 */
function enableWal(db: DatabaseSync): void {
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec("PRAGMA journal_mode = WAL")
      return
    } catch (err) {
      if (attempt >= 50 || !/locked|busy/i.test(String(err))) {
        throw err
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
}
