import { readFile } from "node:fs/promises"
import { extname, relative, resolve, sep } from "node:path"
import type { Context } from "hono"

/**
 * A small static-file handler for a single-page app. Extracted from `Rackbops/kenzen`'s
 * `packages/server/src/static.ts` (simplified from `Rackbops/artifact-console`'s
 * `packages/host/src/static.ts` for Kenzen's K4-2 scope), already fully generic -- no change
 * from the source. Serves from an absolute `staticDir`, rejects path traversal, returns 404 for
 * a genuinely missing known-type asset, and falls back to `index.html` for extension-less
 * routes so client-side routing works.
 *
 * Every response carries a `Cache-Control` from `cacheControl` below. A Vite/rollup SPA pins
 * *unhashed* stable URLs (`index.html`, the entry `/index.js`, `/vendor/*.js` singletons) whose
 * bytes change on every redeploy while the URL does not; served cacheable, they strand a
 * returning browser (and the Cloudflare edge) on the previous deploy's bundle until a manual
 * purge -- observed live at artifact-console's M0 demo (`Rackbops/artifact-console#24`,
 * `alpha.2 -> alpha.3`). Ported from `Rackbops/artifact-console`'s `packages/host/src/static.ts`.
 */

/** A rollup-style content hash before the extension: `index-AbCdEf12.js`. */
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[^.]+$/

/**
 * `Cache-Control` for a *served* path (root-relative, `/`-separated, e.g. `assets/index-X.js`).
 * Immutable only when the file sits directly under an `assets/` directory AND its basename
 * carries a content hash; everything else revalidates (`no-cache`). Both conditions are
 * required, and the key is the served path, so the SPA fallback's `index.html` is classified
 * as `index.html`, never as the client route it answered. Erring toward revalidation is the
 * safe default: a mis-classified hashed asset costs one conditional request, a mis-classified
 * stable URL serves stale code indefinitely.
 */
export function cacheControl(servedPath: string): string {
  const parts = servedPath.replace(/^\/+/, "").split("/")
  const name = parts[parts.length - 1] ?? ""
  const underAssets = parts.length >= 2 && parts[parts.length - 2] === "assets"
  return underAssets && HASHED_ASSET.test(name) ? "public, max-age=31536000, immutable" : "no-cache"
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
}

/**
 * Resolve `relPath` under `root`, or null if it would escape (path traversal). The `root + sep`
 * prefix check also defeats the sibling bypass (`/app/public-secret` vs `/app/public`).
 */
export function resolveWithinRoot(root: string, relPath: string): string | null {
  const resolvedRoot = resolve(root)
  const requested = resolve(resolvedRoot, relPath)
  return requested === resolvedRoot || requested.startsWith(resolvedRoot + sep) ? requested : null
}

export function spaHandler(staticDir: string): (c: Context) => Promise<Response> {
  const root = resolve(staticDir)
  const indexPath = resolve(root, "index.html")

  return async (c: Context): Promise<Response> => {
    const rel = c.req.path === "/" ? "index.html" : c.req.path.replace(/^\/+/, "")
    const requested = resolveWithinRoot(root, rel)

    if (requested !== null) {
      const file = await readSafe(requested)
      if (file !== null) {
        return body(file, requested, servedPath(root, requested))
      }
      // A missing *known asset* (e.g. a purged .js/.css bundle) is a real 404. An unknown or
      // extension-less path (including a client route) falls through to index.html.
      const ext = extname(requested).toLowerCase()
      if (ext !== ".html" && Object.hasOwn(CONTENT_TYPES, ext)) {
        return notFound()
      }
    }

    // SPA fallback: an extension-less route (or a traversal attempt) -> index.html.
    const index = await readSafe(indexPath)
    return index === null ? notFound() : body(index, indexPath, "index.html")
  }
}

function servedPath(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join("/")
}

function body(file: Uint8Array, path: string, served: string): Response {
  const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  return new Response(file, {
    status: 200,
    headers: { "content-type": type, "cache-control": cacheControl(served) },
  })
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-cache" } })
}

async function readSafe(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}
