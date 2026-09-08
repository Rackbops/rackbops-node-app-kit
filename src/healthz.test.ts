import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { healthz } from "./healthz.js"

describe("healthz", () => {
  it("returns {ok, version, apiVersion} exactly, as JSON", async () => {
    const app = new Hono()
    app.get("/healthz", healthz({ version: "1.2.3", apiVersion: 1 }))

    const res = await app.request("/healthz")

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ ok: true, version: "1.2.3", apiVersion: 1 })
  })

  it("reflects whatever version/apiVersion it's given, not a fixed value", async () => {
    const app = new Hono()
    app.get("/healthz", healthz({ version: "9.9.9", apiVersion: 7 }))

    const res = await app.request("/healthz")

    expect(await res.json()).toEqual({ ok: true, version: "9.9.9", apiVersion: 7 })
  })
})
