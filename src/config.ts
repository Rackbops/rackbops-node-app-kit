import { parse as parseToml } from "smol-toml"

/**
 * Config resolution, precedence `<PREFIX>_*` env > `<configDir>/config.toml` > defaults -- the
 * app-config standard (see README): `<PREFIX>_CONFIG_DIR` absolute-only, an answer-file TOML,
 * a blank env value treated as unset rather than as an override, and the resolved config path
 * logged at boot (the caller does the logging; `configSource` tells it which happened).
 *
 * Pure: the environment, the file reader, and the prefix are all injected, so it unit-tests
 * without touching the real filesystem and without hardcoding one app's env-var names.
 * Extracted from `Rackbops/kenzen`'s `packages/server/src/config.ts` (itself derived from
 * `Rackbops/artifact-console`'s `packages/host/src/config.ts`), which is where two blank-env
 * regressions were found and fixed (`Rackbops/artifact-console#145`) -- this module carries
 * those fixes and the tests that guard them, generalized from a hardcoded `KENZEN_*` prefix to
 * a parameter so a second consumer doesn't have to fork the file to get its own env-var names.
 *
 * App-specific fields (a secret token, an identity/Access configuration, ...) are deliberately
 * NOT part of this module -- they typically have no config.toml fallback and no built-in
 * default, so they're read directly from `process.env` by the app itself, the same way Kenzen's
 * own `main.ts` already reads `KENZEN_INGEST_TOKEN` outside `resolveConfig`.
 */

export interface ServerConfig {
  host: string
  port: number
  configDir: string
  configFile: string
  staticDir: string
  stateDir: string
  /** `<stateDir>/<prefix, lowercased>.db` -- e.g. `KENZEN` resolves to `kenzen.db`. */
  dbFile: string
}

export interface ResolvedConfig extends ServerConfig {
  /** Whether the effective config came from a config.toml or fell through to defaults. */
  configSource: "file" | "defaults"
}

export interface ResolveOptions {
  /** The app's env-var prefix, e.g. `"KENZEN"` for `KENZEN_CONFIG_DIR`. Also lowercased to name
   * the sqlite file under `stateDir` (`dbFile`). */
  prefix: string
  /** Reads a file's text, or returns null if it does not exist. Injected for tests. */
  readFile: (path: string) => string | null
  /** Absolute default for the SPA static dir when nothing overrides it. */
  defaultStaticDir: string
}

const DEFAULT_CONFIG_DIR = "/config"
const DEFAULT_STATE_DIR = "/state"
const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 8686

export function resolveConfig(
  env: Record<string, string | undefined>,
  options: ResolveOptions,
): ResolvedConfig {
  const p = options.prefix

  // A set-but-blank value (a common env-file/compose slip) is treated as unset everywhere
  // below, not just for one field -- an artifact-console adversarial review (Tooling#478 K4-2)
  // found this asymmetry back when this was still Kenzen-only code: HOST="" already fell back
  // to the default, but CONFIG_DIR/STATIC_DIR/PORT set to "" hard-crashed instead, and a blank
  // STATIC_DIR even shadowed a valid config.toml value (`??` only skips null/undefined, not
  // ""). None of that was a security issue -- failing loud beats failing silently wrong -- but
  // there's no reason the same env-file slip should be handled differently per field.
  const configDirRaw = nonEmpty(env[`${p}_CONFIG_DIR`])
  if (configDirRaw !== undefined) {
    requireAbsolute(configDirRaw, `${p}_CONFIG_DIR`)
  }
  const configDir = configDirRaw ?? DEFAULT_CONFIG_DIR
  const configFile = `${configDir.replace(/[\\/]+$/, "")}/config.toml`

  const fileText = options.readFile(configFile)
  const configSource: "file" | "defaults" = fileText === null ? "defaults" : "file"
  const fileConfig = fileText === null ? {} : parseConfigFile(fileText, configFile)

  // An empty host must NOT bind all interfaces -- treat it as unset so the loopback default
  // (the security floor) holds.
  const host = nonEmpty(env[`${p}_HOST`]) ?? nonEmpty(asString(fileConfig.host)) ?? DEFAULT_HOST

  const portEnv = nonEmpty(env[`${p}_PORT`])
  let port: number
  if (portEnv !== undefined) {
    port = coercePort(portEnv, `${p}_PORT`)
  } else if ("port" in fileConfig) {
    port = coercePort(fileConfig.port, `${configFile} [port]`)
  } else {
    port = DEFAULT_PORT
  }

  const staticDirEnv = nonEmpty(env[`${p}_STATIC_DIR`])
  const staticDirRaw = staticDirEnv ?? asString(fileConfig.static_dir)
  if (staticDirRaw !== undefined) {
    requireAbsolute(
      staticDirRaw,
      staticDirEnv !== undefined ? `${p}_STATIC_DIR` : `${configFile} [static_dir]`,
    )
  }
  const staticDir = staticDirRaw ?? options.defaultStaticDir

  const stateDirEnv = nonEmpty(env[`${p}_STATE_DIR`])
  const stateDirRaw = stateDirEnv ?? asString(fileConfig.state_dir)
  if (stateDirRaw !== undefined) {
    requireAbsolute(
      stateDirRaw,
      stateDirEnv !== undefined ? `${p}_STATE_DIR` : `${configFile} [state_dir]`,
    )
  }
  const stateDir = stateDirRaw ?? DEFAULT_STATE_DIR
  const dbFile = `${stateDir.replace(/[\\/]+$/, "")}/${p.toLowerCase()}.db`

  return {
    host,
    port,
    configDir,
    configFile,
    staticDir,
    stateDir,
    dbFile,
    configSource,
  }
}

function parseConfigFile(text: string, configFile: string): Record<string, unknown> {
  try {
    return parseToml(text) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`failed to parse ${configFile}: ${detail}`)
  }
}

/** Absolute on POSIX (`/x`) or Windows (`C:\x`, `\\unc`), so paths work cross-platform. */
function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\")
}

function requireAbsolute(p: string, label: string): void {
  if (!isAbsolute(p)) {
    throw new Error(`${label} must be an absolute path, got: ${p}`)
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** Undefined for null/undefined/empty-string, so a blank value falls through to the default. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined
}

/** Validate a port from either env (string) or config.toml (number), with a source-named error. */
function coercePort(value: unknown, label: string): number {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${label} must be an integer 1-65535, got: ${JSON.stringify(value)}`)
  }
  return n
}
