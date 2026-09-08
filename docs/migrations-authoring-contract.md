# Migrations authoring contract

`migrate()` (`@rackbops/node-app-kit/migrate`) applies numbered SQL files from a directory you
provide, tracked by `PRAGMA user_version` on the database (the schema version *is*
`user_version` -- no separate bookkeeping table to drift). This package ships no migrations of
its own -- there is no schema to ship -- only the mechanism. Every consumer's own migrations
directory must follow this contract, which the mechanism enforces or relies on:

- Name each file `NNNN_name.sql` with a **4-digit, zero-padded, unique** number. A `.sql` file
  that doesn't match, or a duplicate number, is a **hard error at boot** -- never a silent skip.
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
  yourself.
- Ship your migrations directory as a sibling of your compiled output (never inside `dist/`,
  since `tsc` won't copy `.sql` files) -- and make sure your Dockerfile or build step actually
  copies it into the image; a missing copy step fails boot with `ENOENT`, not a clear error
  naming the missing directory.

See [`README.md`](../README.md) for `migrate`'s and `state`'s full API.
