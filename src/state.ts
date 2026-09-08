import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { openDatabase } from "./db.js"
import type { Logger } from "./log.js"
import { migrate } from "./migrate.js"

/**
 * Opens the state database and applies migrations -- the boot-time assembly of everything on
 * the state volume. Extracted from `Rackbops/kenzen`'s `packages/server/src/state.ts`
 * (originally adapted from `Rackbops/artifact-console`'s `packages/host/src/state.ts`), already
 * fully generic -- no change from the source (Kenzen's own copy already dropped
 * artifact-console's settings-overlay service, which doesn't belong in a generic boot helper).
 * Logs `state ready` with the schema version and returns it. Creates the state directory if
 * missing (a fresh volume), skipping that for `:memory:`.
 */

export interface State {
  db: DatabaseSync
  schemaVersion: number
}

export interface OpenStateOptions {
  dbFile: string
  migrationsDir: string
  log: Logger
}

export function openState(options: OpenStateOptions): State {
  if (options.dbFile !== ":memory:") {
    mkdirSync(dirname(options.dbFile), { recursive: true })
  }
  const db = openDatabase(options.dbFile)
  const schemaVersion = migrate(db, options.migrationsDir)
  options.log.info("state ready", { dbFile: options.dbFile, schemaVersion })
  return { db, schemaVersion }
}
