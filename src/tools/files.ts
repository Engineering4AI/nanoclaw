import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { join } from "path";
import { makeTool } from "./index.ts";
import type { Tool } from "./index.ts";

function expandUser(p: string): string {
  const home = homedir();
  if (p.startsWith("~/")) return join(home, p.slice(2));
  if (p === "~") return home;
  return p;
}

async function readFile(args: Record<string, unknown>): Promise<string> {
  const path = expandUser(String(args["path"]));
  const startLine = typeof args["start_line"] === "number" ? (args["start_line"] as number) : 1;
  const endLine = typeof args["end_line"] === "number" ? (args["end_line"] as number) : undefined;

  const content = readFileSync(path, { encoding: "utf-8", flag: "r" });
  const lines = content.split("\n");
  const chunk = endLine !== undefined ? lines.slice(startLine - 1, endLine) : lines.slice(startLine - 1);
  return chunk.map((l, i) => `${i + startLine}\t${l}`).join("\n");
}

async function writeFile(args: Record<string, unknown>): Promise<string> {
  const path = expandUser(String(args["path"]));
  const content = String(args["content"]);
  const dir = resolve(path, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf-8");
  return `Written ${content.length} chars to ${path}`;
}

async function editFile(args: Record<string, unknown>): Promise<string> {
  const path = expandUser(String(args["path"]));
  const oldStr = String(args["old_str"]);
  const newStr = String(args["new_str"]);
  const replaceAll = args["replace_all"] === true;

  const text = readFileSync(path, "utf-8");
  if (!text.includes(oldStr)) {
    throw new Error(`old_str not found in ${path}`);
  }
  const count = text.split(oldStr).length - 1;
  if (count > 1 && !replaceAll) {
    throw new Error(
      `old_str matches ${count} times; set replace_all=true or make it unique`,
    );
  }
  const updated = replaceAll
    ? text.split(oldStr).join(newStr)
    : text.replace(oldStr, newStr);
  writeFileSync(path, updated, "utf-8");
  return `Edited ${path}`;
}

export const READ_FILE: Tool = makeTool(
  "read_file",
  "Read file content. Optionally specify start_line / end_line (1-indexed).",
  {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or ~ path to file" },
      start_line: { type: "integer", description: "First line to read (default 1)" },
      end_line: { type: "integer", description: "Last line to read (inclusive, default EOF)" },
    },
    required: ["path"],
  },
  readFile,
);

export const WRITE_FILE: Tool = makeTool(
  "write_file",
  "Write or overwrite a file with given content.",
  {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  writeFile,
);

export const EDIT_FILE: Tool = makeTool(
  "edit_file",
  "Patch a file by replacing old_str with new_str. Fails if old_str not found or matches multiple times unless replace_all=true.",
  {
    type: "object",
    properties: {
      path: { type: "string" },
      old_str: { type: "string" },
      new_str: { type: "string" },
      replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
    },
    required: ["path", "old_str", "new_str"],
  },
  editFile,
);

export const FILE_TOOLS: Tool[] = [READ_FILE, WRITE_FILE, EDIT_FILE];
