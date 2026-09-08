import type { Context } from "hono"

/**
 * A `GET /healthz` Hono handler returning `{ok, version, apiVersion}` -- the health/version
 * shape both `Rackbops/kenzen` and `Rackbops/artifact-console`'s design docs specify. Extracted
 * from Kenzen's `packages/server/src/app.ts`, where it was inlined as a route closure; this is
 * the one module in the extraction that didn't already exist as its own file, since it had
 * never needed to be reused before now.
 *
 * `apiVersion` is the caller's own API-contract version (an integer the caller bumps on a
 * breaking change to its own API, e.g. Kenzen's `API_VERSION`), not this package's version --
 * pass it in explicitly rather than importing anything from `./version.js` here.
 */
export interface HealthzOptions {
  version: string
  apiVersion: number
}

export function healthz(options: HealthzOptions): (c: Context) => Response {
  return (c: Context) =>
    c.json({ ok: true, version: options.version, apiVersion: options.apiVersion })
}
