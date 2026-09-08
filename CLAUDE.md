# rackbops-node-app-kit -- Claude Instructions

`@rackbops/node-app-kit`: shared Node/Hono app-server building blocks (config resolution,
structured logging, `/healthz`, version resolution, SQLite db/migrate/state, SPA static
serving), extracted from `Rackbops/kenzen`'s `packages/server/src/` once Kenzen became the
org's second consumer of code that had already drifted once between it and
`Rackbops/artifact-console` (`Rackbops/artifact-console#145`, `#146`). See
[`docs/PURPOSE.md`](docs/PURPOSE.md) for the full why and the explicit non-goals.

My personal `~/.claude/CLAUDE.md` governs *how I work* -- the review gate, escalation, commit
mechanics, tool routing, shell choice. Not restated here; this file covers only what a session
needs to know about the code in this repo.

## Ground truth

The package's own source is the ground truth -- this repo has no external API surface of its
own to track. When a module was extracted verbatim from Kenzen with no change, its own
doc-comment says so; when it was genuinely adapted (a hardcoded `KENZEN_*` prefix generalized
into a `prefix` parameter, `version.ts`'s caller-URL parameterization to work correctly once
published), the doc-comment explains why, and a test proves the adapted behavior rather than
just the copied one.

## No behind-`node_modules` bugs

The one class of bug specific to this repo that unit tests inside a monorepo can't catch:
**a module that behaves correctly when imported from its own source tree can behave wrong once
published and imported from `node_modules`.** `version.ts`'s `getVersion()` is the worked
example -- the original (Kenzen's own, pre-extraction) resolved `../package.json` relative to
its own file location unconditionally, which was correct only because nothing had ever imported
it from outside its own package. Published as-is, a consumer's `getVersion()` call would have
silently returned *this package's* version instead of the consumer's own. The fix takes the
caller's `import.meta.url` as an explicit parameter; `version.test.ts` proves cross-package
resolution with a real second `package.json` fixture in a temp directory, not just a same-file
read. **When adding or reviewing a module here, ask whether its behavior depends on where its
own file happens to sit on disk -- if so, that assumption breaks the moment it's imported from
`node_modules`, and needs the same "take it as a parameter, test it against a foreign path"
treatment.**

## Adopting a new consumer

A consumer app doesn't get its own fields folded into a shared module's shape (see `config.ts`'s
own doc-comment on why `accessTeamDomain`/`accessAud`-style fields stay out). When a genuinely
new *generic* need shows up in a second or third consumer, extend the shared module's parameters
(as `config.ts`'s `prefix` and `version.ts`'s caller URL already do) rather than branching
behavior on which consumer is calling.

## Testing & checks

`just check` (lint + typecheck + test + build) mirrors CI (`.github/workflows/ci.yml`):
`biome check .`, `tsc --noEmit`, `vitest run`, then `tsc` (build). No experimental Node flag is
needed for `node:sqlite` at the pinned `engines.node >=24`.

## Release

Push to `main` (a squash-merged PR) triggers `release.yml`, which bumps the version from
conventional-commit messages touching `src/`, tags `vX.Y.Z`, and creates a GitHub release; the
tag push triggers `publish.yml`, which publishes to npm under the `@rackbops` scope using the
`NPM_TOKEN` secret (the same pattern `rackbops-ui-ux-std-lib` uses -- a granular
read+write-on-`@rackbops`-scope token, not OIDC trusted publishing, despite that having been the
stated plan when this repo was created; the actual copied-from workflow uses `NPM_TOKEN`, and
this repo matches what's proven working rather than what was assumed). `RELEASE_TOKEN` unset
makes `release.yml` an inert no-op -- both secrets need to exist in this repo's settings before
the first real release.

## Key gotchas

- **`version.ts` needs the caller's `import.meta.url`, always.** See "No behind-`node_modules`
  bugs" above -- calling `getVersion()` with no argument, or with this package's own URL, is the
  bug this module was specifically fixed to prevent.
- **`config.ts` does not grow app-specific fields.** A field only one consumer needs stays in
  that consumer's own code.
- **This package ships no migrations of its own** -- `migrations-authoring-contract.md` is a
  contract document, not a real `migrations/` directory; there is no schema here to migrate.
