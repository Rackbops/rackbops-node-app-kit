import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { getVersion } from "./version.js"

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

function fixturePackage(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "node-app-kit-version-"))
  dirs.push(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }))
  // getVersion never reads the caller path itself, only resolves "../package.json" relative to
  // it -- so this file need not exist for the resolution to work.
  return pathToFileURL(join(dir, "dist", "main.js")).href
}

describe("getVersion", () => {
  it("reads a semver from the caller's own package.json (this file's own, for import.meta.url passed from here)", () => {
    expect(getVersion(import.meta.url)).toMatch(/^\d+\.\d+\.\d+/)
  })

  // Proves resolution is genuinely parameterized by the CALLER's URL, not fixed to this
  // package's own package.json -- the exact bug a naive copy of the original (unparameterized)
  // version.ts would reintroduce once published: an import from inside node_modules would then
  // silently read node-app-kit's OWN version instead of the caller's.
  it("resolves a DIFFERENT package.json when given a different caller URL, not this package's own", () => {
    const otherCaller = fixturePackage("9.9.9-fixture")
    expect(getVersion(otherCaller)).toBe("9.9.9-fixture")
    expect(getVersion(import.meta.url)).not.toBe("9.9.9-fixture")
  })

  it("caches per caller URL rather than re-reading the file on every call", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-app-kit-version-cache-"))
    dirs.push(dir)
    const pkgPath = join(dir, "package.json")
    writeFileSync(pkgPath, JSON.stringify({ version: "1.0.0" }))
    const callerUrl = pathToFileURL(join(dir, "dist", "main.js")).href

    expect(getVersion(callerUrl)).toBe("1.0.0")
    writeFileSync(pkgPath, JSON.stringify({ version: "2.0.0" })) // changed after the first read
    expect(getVersion(callerUrl)).toBe("1.0.0") // still cached, not re-read
  })

  it("falls back to 0.0.0 when the target package.json has no version field", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-app-kit-version-noversion-"))
    dirs.push(dir)
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "no-version-fixture" }))
    const callerUrl = pathToFileURL(join(dir, "dist", "main.js")).href
    expect(getVersion(callerUrl)).toBe("0.0.0")
  })
})
