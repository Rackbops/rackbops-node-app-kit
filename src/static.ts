import { readFile } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import type { Context } from "hono"

/**
 * A small static-file handler for a single-page app. Extracted from `Rackbops/kenzen`'s
 * `packages/server/src/static.ts` (simplified from `Rackbops/artifact-console`'s
 * `packages/host/src/static.ts` for Kenzen's K4-2 scope), already fully generic -- no change
 * from the source. Serves from an absolute `staticDir`, rejects path traversal, returns 404 for
 * a genuinely missing known-type asset, and falls back to `index.html` for extension-less
 * routes so client-side routing works. Dropped (same as the source): content-hashed-bundle
 * cache-control classification -- add it back in a consumer if it starts serving one.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
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
        return body(file, requested)
      }
      // A missing *known asset* (e.g. a purged .js/.css bundle) is a real 404. An unknown or
      // extension-less path (including a client route) falls through to index.html.
      const ext = extname(requested).toLowerCase()
      if (ext !== ".html" && Object.hasOwn(CONTENT_TYPES, ext)) {
        return new Response("Not found", { status: 404 })
      }
    }

    // SPA fallback: an extension-less route (or a traversal attempt) -> index.html.
    const index = await readSafe(indexPath)
    return index === null ? new Response("Not found", { status: 404 }) : body(index, indexPath)
  }
}

function body(file: Uint8Array, path: string): Response {
  const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  return new Response(file, { status: 200, headers: { "content-type": type } })
}

async function readSafe(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}
