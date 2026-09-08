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
tag push triggers `publish.yml`. **`publish.yml` is a byte-for-byte copy of
`rackbops-ui-ux-std-lib`'s** (names substituted only -- diff it against that repo's copy before
believing anything has drifted). Its default auth path is **OIDC trusted publishing** -- no
long-lived token; GitHub mints a short-lived id-token (`permissions: id-token: write`) and npm
exchanges it against the trusted publisher configured on npmjs.com for
`Rackbops`/`rackbops-node-app-kit`/`publish.yml`, generating provenance automatically. `NPM_TOKEN`
is the **break-glass fallback** (classic token auth, no provenance), read by the workflow's own
preflight step -- set it and OIDC is bypassed; leave it unset for normal operation. (An earlier
version of this doc claimed the reverse -- NPM_TOKEN-only, no OIDC -- based on a stale local
checkout of `rackbops-ui-ux-std-lib`; corrected once the actual current file, and a real
successful OIDC publish run against it, were checked.)

**The very first publish is the one genuine exception.** npm requires a trusted publisher to be
configured on an *existing* package's own settings page -- there is no way to pre-register one
for a package that has never been published, so `@rackbops/node-app-kit`'s first-ever `v0.1.0`
publish has to go through the `NPM_TOKEN` break-glass. Once that publish creates the package on
the registry, add the trusted publisher (`Rackbops` / `rackbops-node-app-kit` / `publish.yml`) on
its npmjs.com settings page, then remove the `NPM_TOKEN` secret so every release after that goes
through OIDC, matching `rackbops-ui-ux-std-lib`. `RELEASE_TOKEN` unset makes `release.yml` an
inert no-op regardless of which publish-auth path is in use -- it needs to exist in this repo's
settings before any real release, first or otherwise.

## Key gotchas

- **`version.ts` needs the caller's `import.meta.url`, always.** See "No behind-`node_modules`
  bugs" above -- calling `getVersion()` with no argument, or with this package's own URL, is the
  bug this module was specifically fixed to prevent.
- **`config.ts` does not grow app-specific fields.** A field only one consumer needs stays in
  that consumer's own code.
- **This package ships no migrations of its own** -- `migrations-authoring-contract.md` is a
  contract document, not a real `migrations/` directory; there is no schema here to migrate.
