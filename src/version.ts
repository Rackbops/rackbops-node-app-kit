import { readFileSync } from "node:fs"

/**
 * Reads a package's version from its own `package.json` at runtime -- single source of truth
 * for a `/healthz` response. Extracted from `Rackbops/kenzen`'s `packages/server/src/version.ts`
 * (originally copied from `Rackbops/artifact-console`'s `packages/host/src/version.ts`).
 *
 * Takes the CALLER's own `import.meta.url`, not this package's. `../package.json` resolves
 * relative to whichever URL is passed in, so a consuming app calling `getVersion(import.meta.url)`
 * from its own `main.ts` reads *its own* package.json -- not this package's. That parameter is
 * the one real behaviour change from the source: the original file resolved `../package.json`
 * relative to its own location unconditionally, which was correct only because it had never
 * been imported from outside its own package. Published as-is, an import from inside
 * `node_modules/@rackbops/node-app-kit/dist/` would have resolved this package's OWN version
 * instead of the caller's -- silently wrong in exactly the way `/healthz` exists to report
 * correctly. See `version.test.ts` for the regression test proving cross-package resolution.
 *
 * Both a `src/*.ts` caller (Vitest) and a compiled `dist/*.js` caller resolve the same way, as
 * long as the caller's own file sits one directory below its own `package.json` -- true of a
 * typical `src/main.ts` -> `dist/main.js` layout.
 */

interface PackageJson {
  version?: string
}

const cache = new Map<string, string>()

export function getVersion(callerImportMetaUrl: string): string {
  const cached = cache.get(callerImportMetaUrl)
  if (cached !== undefined) {
    return cached
  }
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", callerImportMetaUrl), "utf8"),
  ) as PackageJson
  const version = pkg.version ?? "0.0.0"
  cache.set(callerImportMetaUrl, version)
  return version
}
