# @rackbops/node-app-kit

Shared Node/Hono app-server building blocks, extracted from `Rackbops/kenzen` once it became
the org's second consumer of the same handful of files `Rackbops/artifact-console` already
carried. See [`docs/PURPOSE.md`](docs/PURPOSE.md) for why this exists as its own package rather
than another copy.

## Install

```bash
pnpm add @rackbops/node-app-kit hono
```

`hono` is a **peer dependency** -- only `healthz` and `static` need it; `config`, `log`, `db`,
`migrate`, and `state` are framework-free.

## Modules

Each is its own subpath export, so a consumer imports only what it uses.

### `@rackbops/node-app-kit/config`

```ts
import { readFileSync } from "node:fs"
import { resolveConfig } from "@rackbops/node-app-kit/config"

// `null` means "no config file", so only ENOENT may return it: swallowing EACCES or EISDIR
// would boot the app on defaults and silently ignore the operator's config.
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

const config = resolveConfig(process.env, {
  prefix: "KENZEN", // -> reads KENZEN_CONFIG_DIR, KENZEN_HOST, KENZEN_PORT, ...
  readFile: readFileOrNull,
  defaultStaticDir: "/app/public",
  defaultPort: 8686, // optional -- omit to keep this module's own 8686 fallback
})
```

Precedence `<PREFIX>_*` env > `<configDir>/config.toml` > `defaultPort` (if given) > this
module's own built-in `8686` fallback (only when `defaultPort` is omitted -- Kenzen's own value,
the extraction source). Resolves `host`, `port`, `configDir`, `configFile`, `staticDir`,
`stateDir`, `dbFile` (named `<lowercased prefix>.db` under `stateDir`), and `configSource`
(`"file"` or `"defaults"`, for the boot-log line the app-config standard asks every app to
print). A **set-but-blank** env var (a common `.env`/compose slip) is treated as unset for every
field, not silently accepted or crashed on. App-specific fields (a secret token, an
Access/identity configuration) are deliberately **not** part of this module -- read those
directly from `process.env` yourself, the same way Kenzen reads `KENZEN_INGEST_TOKEN` outside
`resolveConfig`.

**On Windows, `<PREFIX>_CONFIG_DIR` must be set, and so must `<PREFIX>_STATE_DIR` unless
`config.toml` supplies `state_dir`.** The `/state` and `/config` defaults are right in a container, but on Windows they
resolve to the current drive's root, shared by every checkout and run
(`Rackbops/kenzen#72`), so `resolveConfig` throws when it would fall back to either on
`process.platform === "win32"`. An explicit value is never second-guessed. Pass `platform` in the
options to override the detected platform (tests).

**Pass `defaultPort` explicitly if your own default differs from `8686`.** Relying on the
built-in fallback coinciding with your app's real default is exactly what silently broke
`artifact-console` (`Rackbops/artifact-console#161`, its own default is `8787`) -- caught only by
a real Docker boot in CI, since nothing else exercises a true zero-config boot against a real
container. There is no `defaultStaticDir`-shaped "this has to be provided" requirement here
only because the original `8686` fallback has to stay the default when the option is omitted, to
keep every existing caller's behaviour unchanged; a *new* consumer should still always pass its
own real default rather than lean on that fallback.

### `@rackbops/node-app-kit/log`

```ts
import { createLogger } from "@rackbops/node-app-kit/log"

const log = createLogger()
log.info("config resolved", { source: config.configSource })
const requestLog = log.child({ requestId })
```

One JSON line per record to stdout (`time`, `level`, `msg`, plus bound/per-call fields).
`child()` returns a logger with extra fields merged into every subsequent record.

### `@rackbops/node-app-kit/healthz`

```ts
import { healthz } from "@rackbops/node-app-kit/healthz"

app.get("/healthz", healthz({ version: getVersion(import.meta.url), apiVersion: API_VERSION }))
```

Returns `{ok: true, version, apiVersion}` as JSON. `apiVersion` is your own API-contract
version, not this package's.

### `@rackbops/node-app-kit/version`

```ts
import { getVersion } from "@rackbops/node-app-kit/version"

const version = getVersion(import.meta.url) // reads YOUR package.json, not this one's
```

Reads a semver from a `package.json` at runtime, cached per caller URL. **Always pass your own
`import.meta.url`** -- resolution is relative to the URL you pass in, so this correctly reads
your app's own version even though the function lives inside `node_modules`.

### `@rackbops/node-app-kit/db`, `.../migrate`, `.../state`

```ts
import { openState } from "@rackbops/node-app-kit/state"

const state = openState({ dbFile: config.dbFile, migrationsDir: "/app/migrations", log })
// state.db: a node:sqlite DatabaseSync handle (WAL, foreign_keys on)
// state.schemaVersion: the PRAGMA user_version after migrating
```

`db` opens a `node:sqlite` database (WAL, foreign keys on). `migrate` applies numbered
`NNNN_name.sql` files from a directory you own, tracked by `PRAGMA user_version` -- see
[`docs/migrations-authoring-contract.md`](docs/migrations-authoring-contract.md) for the full
authoring contract (numbering `0001..NNNN` with no gap, append-only, one transaction per file with foreign-key
enforcement suspended and checked, safe against two processes migrating at once).
`state` is the boot-time combination of both: open the database, migrate, log `state ready` with
the resulting schema version.

### `@rackbops/node-app-kit/static`

```ts
import { spaHandler } from "@rackbops/node-app-kit/static"

app.get("*", spaHandler(config.staticDir))
```

Serves a single-page app from an absolute directory: rejects path traversal, returns a real 404
for a missing known-type asset, and falls back to `index.html` for extension-less routes so
client-side routing works. Every response carries `Cache-Control`: `public, max-age=31536000,
immutable` only for a content-hashed file directly under `assets/` (`assets/index-AbCdEf12.js`),
`no-cache` for everything else (`index.html`, `/index.js`, `/vendor/*.js`, the SPA fallback, 404s),
so an unhashed stable URL is never served stale after a redeploy. The hash must be exactly 8
characters (Vite/rollup's default), and the server sends no `ETag`/`Last-Modified`, so `no-cache`
files are re-downloaded in full. Don't put hand-named files in `public/assets/`: a name ending in a hyphen plus 8 characters
with a capital or digit (`my-Logo2024.png`) looks like a hash and would be cached for a year.

## What's not here

The deploy shape (`compose.yaml`, `Dockerfile`, CI release workflows) stays in
`Rackbops/rackbops-web-deploy-template`'s `servers/node-app` scaffold -- those are per-repo files
by nature, not package code. App-specific config fields, auth/identity, and every route stay in
the consuming app. See [`docs/PURPOSE.md`](docs/PURPOSE.md) for the full non-goals list.

## Consumers

- [`Rackbops/kenzen`](https://github.com/Rackbops/kenzen) -- the extraction source; imports
  `config`, `log`, `state`, `version`, `healthz` and `static` (its lockfile resolves 0.1.4).
- `Rackbops/artifact-console` 2.0 -- has adopted `config`, `db`, `migrate` and `log`.

## Development

```bash
just install   # pnpm install --frozen-lockfile
just check     # lint + typecheck + test + build
just fix       # biome check --write (format + lint autofix in one pass)
```

See [`Justfile`](Justfile) for the full recipe list, or run `just` with no arguments.
