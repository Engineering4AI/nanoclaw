import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const HOME = homedir();

const DEFAULT_CONFIG_PATH = join(HOME, ".nanoclaw", "config.yaml");
const DEFAULT_WORKSPACE = join(HOME, ".nanoclaw", "workspace");
const DEFAULT_SESSIONS = join(HOME, ".nanoclaw", "sessions");

export interface Config {
  model: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  maxIterations: number;
  workspace: string;
  sessionsDir: string;
  permissionMode: string;
  webProxy: string;
}

function expandUser(p: string): string {
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  if (p === "~") return HOME;
  return p;
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): Config {
  const cfg: Config = {
    model: "anthropic/claude-sonnet-4-6",
    provider: "openai_compatible",
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    maxTokens: 8192,
    maxIterations: 40,
    workspace: DEFAULT_WORKSPACE,
    sessionsDir: DEFAULT_SESSIONS,
    permissionMode: "default",
    webProxy: "",
  };

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    const data = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(data)) {
      if (k === "workspace" || k === "sessions_dir" || k === "sessionsDir") {
        const key = k === "sessions_dir" ? "sessionsDir" : k as keyof Config;
        (cfg as Record<string, unknown>)[key] = expandUser(String(v));
      } else if (k in cfg) {
        (cfg as Record<string, unknown>)[k] = v;
      }
      // handle snake_case from YAML
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      if (camel !== k && camel in cfg) {
        (cfg as Record<string, unknown>)[camel] = v;
      }
    }
  }

  // env overrides
  cfg.apiKey =
    process.env["OPENROUTER_API_KEY"] ??
    process.env["ANTHROPIC_API_KEY"] ??
    process.env["OPENAI_API_KEY"] ??
    cfg.apiKey;

  if (process.env["NANOCLAW_MODEL"]) cfg.model = process.env["NANOCLAW_MODEL"];
  if (process.env["NANOCLAW_PROVIDER"]) cfg.provider = process.env["NANOCLAW_PROVIDER"];
  if (process.env["NANOCLAW_BASE_URL"]) cfg.baseUrl = process.env["NANOCLAW_BASE_URL"];
  if (process.env["NANOCLAW_MAX_TOKENS"]) cfg.maxTokens = parseInt(process.env["NANOCLAW_MAX_TOKENS"], 10);
  if (process.env["NANOCLAW_MAX_ITERATIONS"]) cfg.maxIterations = parseInt(process.env["NANOCLAW_MAX_ITERATIONS"], 10);
  if (process.env["NANOCLAW_PERMISSION_MODE"]) cfg.permissionMode = process.env["NANOCLAW_PERMISSION_MODE"];
  if (process.env["NANOCLAW_WEB_PROXY"]) cfg.webProxy = process.env["NANOCLAW_WEB_PROXY"];
  if (process.env["NANOCLAW_WORKSPACE"]) cfg.workspace = expandUser(process.env["NANOCLAW_WORKSPACE"]);

  return cfg;
}

export function saveConfig(cfg: Config, configPath: string = DEFAULT_CONFIG_PATH): void {
  mkdirSync(resolve(configPath, ".."), { recursive: true });
  const data = {
    model: cfg.model,
    provider: cfg.provider,
    api_key: cfg.apiKey,
    base_url: cfg.baseUrl,
    max_tokens: cfg.maxTokens,
    max_iterations: cfg.maxIterations,
    workspace: cfg.workspace,
    sessions_dir: cfg.sessionsDir,
    permission_mode: cfg.permissionMode,
    web_proxy: cfg.webProxy,
  };
  writeFileSync(configPath, stringifyYaml(data));
}
