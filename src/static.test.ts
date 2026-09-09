import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { resolveWithinRoot, spaHandler } from "./static.js"

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/public")

function appWith(staticDir: string): Hono {
  const app = new Hono()
  app.get("*", spaHandler(staticDir))
  return app
}

describe("resolveWithinRoot", () => {
  it("resolves a path inside root", () => {
    expect(resolveWithinRoot(fixtureDir, "style.css")).toBe(resolve(fixtureDir, "style.css"))
  })

  it("rejects a traversal attempt", () => {
    expect(resolveWithinRoot(fixtureDir, "../../../etc/passwd")).toBeNull()
  })

  it("rejects a sibling-directory bypass sharing the root as a string prefix", () => {
    expect(resolveWithinRoot(fixtureDir, "../public-secret/x")).toBeNull()
  })

  it("allows the root itself", () => {
    expect(resolveWithinRoot(fixtureDir, ".")).toBe(resolve(fixtureDir))
  })
})

describe("spaHandler", () => {
  it("serves index.html at /", async () => {
    const res = await appWith(fixtureDir).request("/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toContain("node-app-kit-fixture-index")
  })

  it("serves a known asset with the right content-type", async () => {
    const res = await appWith(fixtureDir).request("/style.css")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/css")
    expect(await res.text()).toContain("color: red")
  })

  it("falls back to index.html for an unknown, extension-less route (SPA routing)", async () => {
    const res = await appWith(fixtureDir).request("/some/client/route")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("node-app-kit-fixture-index")
  })

  it("returns a real 404 for a missing asset with a known extension, not the HTML fallback", async () => {
    const res = await appWith(fixtureDir).request("/missing-bundle.js")
    expect(res.status).toBe(404)
  })

  it("serves a .webp with the image/webp content-type", async () => {
    const res = await appWith(fixtureDir).request("/banner.webp")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/webp")
    expect(await res.text()).toContain("fixture-webp-content")
  })

  it("serves a .woff2 with the font/woff2 content-type", async () => {
    const res = await appWith(fixtureDir).request("/font.woff2")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("font/woff2")
    expect(await res.text()).toContain("fixture-woff2-content")
  })

  it("returns a real 404 for a missing .webp, not the HTML fallback (#13)", async () => {
    // Before #13, a missing asset whose extension wasn't in CONTENT_TYPES fell through to the
    // SPA fallback with a 200 -- a purged or misnamed image silently returned the HTML shell to
    // an <img>, invisible to any check that only looks at status.
    const res = await appWith(fixtureDir).request("/missing-banner.webp")
    expect(res.status).toBe(404)
  })

  it("returns a real 404 for a missing .woff2, not the HTML fallback", async () => {
    // Only the "serves a .woff2" test above exercised this entry before -- nothing guarded the
    // 404-vs-fallback half specifically for a font, only for .webp.
    const res = await appWith(fixtureDir).request("/missing-font.woff2")
    expect(res.status).toBe(404)
  })

  it("404s a client-route-shaped path whose last segment looks like a mapped asset -- an accepted tradeoff (#13, #14 gate)", async () => {
    // Widening CONTENT_TYPES widens the 404 rule along with it: a client-side route whose last
    // segment happens to look like one of the newly-mapped extensions (e.g. a REST-ish
    // "/reports/2026.xml") now 404s here instead of falling through to index.html, whereas before
    // #13 only .html/.js/.css/.json/.svg/.png/.ico could trigger this. That is the intended fix,
    // not a side effect: an issue-13 "missing asset" and a "route that happens to look like one"
    // are indistinguishable to this handler by design (it never knows the consumer's route table),
    // so a consumer whose router uses a dotted, asset-extension-shaped segment must expect a 404
    // here, not a rendered page. Checked against both real consumers of this module import path --
    // Kenzen's routes (needs-decision, repos, decided, dependabot, history) and artifact-console's
    // wildcard shell route -- neither uses a dotted segment; artifact-console additionally doesn't
    // even import this module's spaHandler (its own static.ts is a deliberate, independent fork,
    // see that file's own doc-comment). See the PR body's "Consumer-facing behaviour change"
    // section for the full disclosure.
    const res = await appWith(fixtureDir).request("/reports/2026.xml")
    expect(res.status).toBe(404)
  })

  it("a URL-encoded traversal attempt never escapes staticDir (falls back to index.html, not a 500 or a leaked file)", async () => {
    const res = await appWith(fixtureDir).request("/..%2f..%2f..%2fetc%2fpasswd")
    // `%2f` is never decoded into a literal `/` by this handler, so it can't become a real path
    // separator -- the whole string is treated as one opaque, nonexistent filename, which falls
    // through to the SPA fallback exactly like any other unknown route. 200 + the shell is the
    // correct, safe outcome here; the one outcome that must never happen is serving a file
    // outside staticDir, which resolveWithinRoot's own tests above cover directly with real
    // (unencoded) separators.
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("node-app-kit-fixture-index")
  })
})
