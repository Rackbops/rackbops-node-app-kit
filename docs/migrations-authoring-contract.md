# Migrations authoring contract

`migrate()` (`@rackbops/node-app-kit/migrate`) applies numbered SQL files from a directory you
provide, tracked by `PRAGMA user_version` on the database (the schema version *is*
`user_version` -- no separate bookkeeping table to drift). This package ships no migrations of
its own -- there is no schema to ship -- only the mechanism. Every consumer's own migrations
directory must follow this contract, which the mechanism enforces or relies on:

- Name each file `NNNN_name.sql` with a **4-digit, zero-padded, unique** number. A `.sql` file
  that doesn't match, or a duplicate number, is a **hard error at boot** -- never a silent skip.
- **Numbers run `0001..NNNN` with no gap.** A missing number is a hard error naming it, so a
  migration that lands late under a lower number than a database already at a higher version
  can never be skipped silently. Renumber the late migration above the highest one instead.
- **An older build refuses a newer database.** If the database's `user_version` is above the
  highest migration on disk, `migrate()` throws rather than running old code on a schema it
  does not know (rollbacks, an old CLI checkout).
- **Numbers start at `0001`, not `0000`.** `migrate()` rejects a `0000_*.sql` file outright: a
  fresh database's schema version already starts at `0`, so a `0000` migration would otherwise
  be silently and permanently skipped forever (found by an adversarial review on
  `Rackbops/kenzen`'s K4-3, `Rackbops/Tooling#478` -- a trap this package's `migrate.ts` closes
  that its source, `Rackbops/artifact-console`'s own copy, did not yet close at the time).
- **Append-only and immutable.** A shipped migration has already run on deployed instances
  (their `user_version` is past it), so editing it never re-runs there and only drifts fresh
  installs. To change the schema, add a **higher-numbered** migration. This is an
  escalation-class contract in the sense roshne's personal `CLAUDE.md` uses the term: existing
  installs resolve their data by it, so a repurposed or deleted migration number is not a
  routine change.
- Each file runs inside **one implicit transaction** (`migrate()` wraps it in `BEGIN`/`COMMIT`);
  a failure rolls the whole file back. Do **not** put `BEGIN`/`COMMIT` in a migration file
  yourself (a `COMMIT` in the file makes it fail), and `migrate()` refuses to start inside a
  transaction the caller already opened. `migrate()` runs each file with `PRAGMA foreign_keys = OFF` (restored afterwards),
  so SQLite's table-rebuild recipe (create new, copy, drop old, rename) does not cascade
  through child tables, then runs `PRAGMA foreign_key_check` and rolls the file back if any
  reference dangles (violations that already existed before the file ran are not held against
  it). A rebuild must also drop and recreate any view or trigger on the table: SQLite drops a
  trigger with its table, and renaming into the name a view reads from fails. The transaction is `BEGIN IMMEDIATE` and the version is re-read inside it,
  so two processes migrating one database at once apply each file once (open the handle with
  `openDatabase`, which sets a 5 s busy timeout so the second process waits).
- Ship your migrations directory as a sibling of your compiled output (never inside `dist/`,
  since `tsc` won't copy `.sql` files) -- and make sure your Dockerfile or build step actually
  copies it into the image; a missing copy step fails boot with `ENOENT`, not a clear error
  naming the missing directory.

See [`README.md`](../README.md) for `migrate`'s and `state`'s full API.
