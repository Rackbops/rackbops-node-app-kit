# Purpose

`@rackbops/node-app-kit` is the small set of Node/Hono app-server building blocks that showed
up identically in two of roshne's backends -- `Rackbops/artifact-console` and `Rackbops/kenzen`
-- and had already drifted once between the two copies (`Rackbops/artifact-console#145`, a
blank-env config crash; `#146`, a silently-skipped `0000` migration -- both found in one copy,
fixed there, and not yet present in the other). Copy-consumption is fine for a deploy shape
(each app's `compose.yaml`/`Dockerfile` genuinely differs); it is the wrong choice for *code*
that is byte-for-byte identical logic with identical bugs to fix twice. This package extracts
that code once, with its regression tests, so a third consumer never re-forks it and a fix
lands for every consumer at once.

## What's in scope

Five small, independent concerns, each its own subpath export: `config` (env/file/default
resolution per the app-config standard), `log` (structured JSON logging), `healthz` (the
`{ok, version, apiVersion}` handler), `version` (reads a package's own version at runtime),
`db`/`migrate`/`state` (SQLite open + numbered migrations + boot-time assembly), and `static`
(SPA file serving). Each is framework-free except `healthz` and `static`, which are Hono
handlers (`hono` is a peer dependency, not bundled).

## Explicit non-goals

- **Not a framework.** No routing, no app composition, no dependency injection. A consumer
  wires these functions into its own Hono app itself.
- **Not app-specific config.** A secret token, an auth/identity configuration, or any field
  with no shared shape across consumers stays in the consuming app, read directly from
  `process.env` -- see `config`'s own module doc for why.
- **Not a schema.** `migrate`/`state` are the mechanism; every consumer owns its own numbered
  `.sql` files and its own tables.
- **Not a deploy shape.** `compose.yaml`, `Dockerfile`, and CI release workflows are
  per-repo files by nature and stay in `Rackbops/rackbops-web-deploy-template`'s
  `servers/node-app` scaffold, not in this package.

## Audience

Rackbops-org Node/Hono backends. Currently `Rackbops/kenzen`; `Rackbops/artifact-console` 2.0
adopts it next (tracked as its own child issue, prose-linked from that repo's E2 epic).
