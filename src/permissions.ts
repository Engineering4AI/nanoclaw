import micromatch from "micromatch";
import { homedir } from "os";
import { join } from "path";

const HOME = homedir();

export enum PermissionMode {
  DEFAULT = "default",
  AUTO = "auto",
  PLAN = "plan",
}

export class PermissionDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDenied";
  }
}

export class PermissionRequired extends Error {
  constructor(
    public readonly tool: string,
    public readonly args: Record<string, unknown>,
  ) {
    super(`Permission required for ${tool}`);
    this.name = "PermissionRequired";
  }
}

export interface PathRule {
  pattern: string;
  allow: boolean;
}

const SENSITIVE_PATHS: string[] = [
  join(HOME, ".ssh", "*"),
  join(HOME, ".aws", "*"),
  join(HOME, ".config", "*", "credentials"),
  join(HOME, ".gnupg", "*"),
  join(HOME, ".netrc"),
];

const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const EXEC_TOOLS = new Set(["run_bash"]);

export class PermissionPolicy {
  constructor(
    public readonly mode: PermissionMode = PermissionMode.DEFAULT,
    public readonly pathRules: PathRule[] = [],
    public readonly deniedCommands: string[] = [],
  ) {}

  static fromMode(mode: string): PermissionPolicy {
    return new PermissionPolicy(mode as PermissionMode);
  }

  check(tool: string, args: Record<string, unknown>): void {
    if (
      this.mode === PermissionMode.PLAN &&
      (WRITE_TOOLS.has(tool) || EXEC_TOOLS.has(tool))
    ) {
      throw new PermissionDenied(`${tool} blocked in PLAN mode`);
    }

    const path = String(args["path"] ?? args["file_path"] ?? "");
    if (path) {
      this._checkPath(path);
    }

    // custom path rules
    for (const rule of this.pathRules) {
      const expanded = expandUser(rule.pattern);
      if (micromatch.isMatch(path, expanded)) {
        if (!rule.allow) {
          throw new PermissionDenied(`Path blocked by rule: ${rule.pattern}`);
        }
        break;
      }
    }

    // denied commands prefix check
    if (tool === "run_bash") {
      const cmd = String(args["command"] ?? "");
      for (const denied of this.deniedCommands) {
        if (cmd.startsWith(denied)) {
          throw new PermissionDenied(`Command blocked: starts with '${denied}'`);
        }
      }
    }

    // DEFAULT mode: write/shell requires caller approval
    if (this.mode === PermissionMode.DEFAULT) {
      if (WRITE_TOOLS.has(tool) || EXEC_TOOLS.has(tool)) {
        throw new PermissionRequired(tool, args);
      }
    }
  }

  private _checkPath(path: string): void {
    for (const pattern of SENSITIVE_PATHS) {
      if (micromatch.isMatch(path, pattern)) {
        throw new PermissionDenied(`Access to sensitive path blocked: ${path}`);
      }
    }
  }
}

function expandUser(p: string): string {
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  if (p === "~") return HOME;
  return p;
}
