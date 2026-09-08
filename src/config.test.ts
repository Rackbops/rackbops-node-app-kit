import { describe, expect, it } from "vitest"
import { resolveConfig } from "./config.js"

// prefix "KENZEN" throughout: these are the exact assertions carried over from
// Rackbops/kenzen's own config.test.ts, proving the extraction is behaviour-identical for that
// consumer. A second describe block below proves the prefix is a genuine parameter, not
// hardcoded.
const PREFIX = "KENZEN"

const opts = (readFile: (path: string) => string | null) => ({
  prefix: PREFIX,
  readFile,
  defaultStaticDir: "/app/public",
})

describe("resolveConfig", () => {
  it("falls through to defaults with no env and no config file", () => {
    const cfg = resolveConfig(
      {},
      opts(() => null),
    )
    expect(cfg.host).toBe("127.0.0.1")
    expect(cfg.port).toBe(8686)
    expect(cfg.staticDir).toBe("/app/public")
    expect(cfg.configFile).toBe("/config/config.toml")
    expect(cfg.configSource).toBe("defaults")
    expect(cfg.stateDir).toBe("/state")
    expect(cfg.dbFile).toBe("/state/kenzen.db")
  })

  it("KENZEN_STATE_DIR relocates the db file and must be absolute", () => {
    expect(
      resolveConfig(
        { KENZEN_STATE_DIR: "/data/kenzen" },
        opts(() => null),
      ).dbFile,
    ).toBe("/data/kenzen/kenzen.db")
    expect(() =>
      resolveConfig(
        { KENZEN_STATE_DIR: "relative/state" },
        opts(() => null),
      ),
    ).toThrow(/KENZEN_STATE_DIR must be an absolute path, got: relative\/state/)
  })

  it("reads state_dir from config.toml when KENZEN_STATE_DIR is unset", () => {
    const cfg = resolveConfig(
      {},
      opts(() => 'state_dir = "/srv/state"\n'),
    )
    expect(cfg.dbFile).toBe("/srv/state/kenzen.db")
  })

  it("an empty KENZEN_STATE_DIR falls through to the default rather than throwing", () => {
    const cfg = resolveConfig(
      { KENZEN_STATE_DIR: "" },
      opts(() => null),
    )
    expect(cfg.stateDir).toBe("/state")
  })

  it("a blank KENZEN_STATE_DIR plus a bad relative state_dir in the file blames the file, not the env var", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_STATE_DIR: "" },
        opts(() => 'state_dir = "rel/path"\n'),
      ),
    ).toThrow(/\[state_dir\] must be an absolute path, got: rel\/path/)
  })

  it("reads host/port/static_dir from config.toml when present", () => {
    const toml = 'host = "0.0.0.0"\nport = 9000\nstatic_dir = "/srv/spa"\n'
    const cfg = resolveConfig(
      {},
      opts((p) => (p === "/config/config.toml" ? toml : null)),
    )
    expect(cfg.host).toBe("0.0.0.0")
    expect(cfg.port).toBe(9000)
    expect(cfg.staticDir).toBe("/srv/spa")
    expect(cfg.configSource).toBe("file")
  })

  it("KENZEN_* env overrides both the file and the defaults", () => {
    const toml = 'host = "0.0.0.0"\nport = 9000\n'
    const cfg = resolveConfig(
      { KENZEN_HOST: "10.0.0.1", KENZEN_PORT: "1234", KENZEN_STATIC_DIR: "/srv/env" },
      opts(() => toml),
    )
    expect(cfg.host).toBe("10.0.0.1")
    expect(cfg.port).toBe(1234)
    expect(cfg.staticDir).toBe("/srv/env")
  })

  it("an empty KENZEN_HOST falls through to the default rather than binding blank", () => {
    const cfg = resolveConfig(
      { KENZEN_HOST: "" },
      opts(() => null),
    )
    expect(cfg.host).toBe("127.0.0.1")
  })

  // A set-but-blank value (a common env-file/compose slip) must be treated as unset for
  // EVERY field, not just KENZEN_HOST -- an adversarial review on Kenzen's K4-2 found this
  // asymmetry inherited from artifact-console's own config.ts and asked for it to be fixed.
  it("an empty KENZEN_CONFIG_DIR falls through to the default dir rather than throwing", () => {
    const cfg = resolveConfig(
      { KENZEN_CONFIG_DIR: "" },
      opts(() => null),
    )
    expect(cfg.configFile).toBe("/config/config.toml")
  })

  it("an empty KENZEN_PORT falls through to config.toml's port rather than throwing", () => {
    const cfg = resolveConfig(
      { KENZEN_PORT: "" },
      opts(() => "port = 9000\n"),
    )
    expect(cfg.port).toBe(9000)
  })

  it("an empty KENZEN_STATIC_DIR falls through to config.toml's static_dir, not the default, and not a throw", () => {
    const cfg = resolveConfig(
      { KENZEN_STATIC_DIR: "" },
      opts(() => 'static_dir = "/srv/from-file"\n'),
    )
    expect(cfg.staticDir).toBe("/srv/from-file")
  })

  it("a blank KENZEN_STATIC_DIR plus a bad relative static_dir in the file blames the file, not the env var", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_STATIC_DIR: "" },
        opts(() => 'static_dir = "rel/path"\n'),
      ),
    ).toThrow(/\[static_dir\] must be an absolute path, got: rel\/path/)
  })

  it("KENZEN_CONFIG_DIR relocates the config file and must be absolute", () => {
    expect(
      resolveConfig(
        { KENZEN_CONFIG_DIR: "/etc/kenzen" },
        opts(() => null),
      ).configFile,
    ).toBe("/etc/kenzen/config.toml")
    expect(() =>
      resolveConfig(
        { KENZEN_CONFIG_DIR: "relative/dir" },
        opts(() => null),
      ),
    ).toThrow(/KENZEN_CONFIG_DIR must be an absolute path, got: relative\/dir/)
  })

  it("KENZEN_STATIC_DIR must be absolute", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_STATIC_DIR: "rel/spa" },
        opts(() => null),
      ),
    ).toThrow(/absolute/)
  })

  it("rejects an out-of-range or non-numeric KENZEN_PORT (no silent truncation)", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_PORT: "70000" },
        opts(() => null),
      ),
    ).toThrow(/1-65535/)
    expect(() =>
      resolveConfig(
        { KENZEN_PORT: "8080abc" },
        opts(() => null),
      ),
    ).toThrow(/1-65535/)
  })

  it("rejects an out-of-range port from config.toml instead of silently defaulting", () => {
    expect(() =>
      resolveConfig(
        {},
        opts(() => "port = 0\n"),
      ),
    ).toThrow(/1-65535/)
  })

  it("raises a clear, config-file-named error on invalid TOML rather than a raw parser error", () => {
    expect(() =>
      resolveConfig(
        {},
        opts(() => "not = valid = toml"),
      ),
    ).toThrow(/failed to parse \/config\/config\.toml/)
  })
})

// Proves `prefix` is a genuine parameter, not a relabeled hardcoded "KENZEN" -- the whole
// reason this module exists as a shared package rather than a per-app fork. Uses a
// deliberately different prefix throughout so a regression back to a hardcoded literal fails
// loudly here without needing to touch the KENZEN-prefixed suite above.
describe("resolveConfig with a different prefix", () => {
  const acOpts = (readFile: (path: string) => string | null) => ({
    prefix: "AC",
    readFile,
    defaultStaticDir: "/app/public",
  })

  it("reads AC_* env vars, not KENZEN_*", () => {
    const cfg = resolveConfig(
      { AC_HOST: "10.0.0.2", AC_PORT: "9001", KENZEN_HOST: "10.0.0.9" },
      acOpts(() => null),
    )
    expect(cfg.host).toBe("10.0.0.2")
    expect(cfg.port).toBe(9001)
  })

  it("names the db file after the lowercased prefix", () => {
    expect(
      resolveConfig(
        {},
        acOpts(() => null),
      ).dbFile,
    ).toBe("/state/ac.db")
  })

  it("names the offending var after the prefix in an error, not KENZEN_*", () => {
    expect(() =>
      resolveConfig(
        { AC_STATE_DIR: "relative" },
        acOpts(() => null),
      ),
    ).toThrow(/^AC_STATE_DIR must be an absolute path/)
  })
})
