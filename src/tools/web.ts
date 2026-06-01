import { parse as parseHtml } from "node-html-parser";
import { makeTool } from "./index.ts";
import type { Tool } from "./index.ts";

const USER_AGENT = "NanoClaw/1.0";
const FETCH_TIMEOUT = 30_000; // ms

function getProxy(): string {
  // Never inherit HTTP_PROXY — only use NANOCLAW_WEB_PROXY
  return process.env["NANOCLAW_WEB_PROXY"] ?? "";
}

function validateProxy(proxy: string): void {
  if (!proxy.startsWith("http://") && !proxy.startsWith("https://")) {
    throw new Error("NANOCLAW_WEB_PROXY must start with http:// or https://");
  }
  try {
    const url = new URL(proxy);
    if (url.username || url.password) {
      throw new Error("Proxy credentials in URL are not allowed");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("credentials")) throw err;
    throw new Error(`Invalid proxy URL: ${proxy}`);
  }
}

async function makeFetch(url: string): Promise<Response> {
  const proxy = getProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  const fetchOptions: RequestInit = {
    signal: controller.signal,
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  };

  try {
    if (proxy) {
      validateProxy(proxy);
      // Use undici ProxyAgent for explicit proxy without inheriting env
      const { ProxyAgent, fetch: undiciFetch } = await import("undici");
      const dispatcher = new ProxyAgent(proxy);
      const resp = await undiciFetch(url, { ...fetchOptions, dispatcher } as RequestInit);
      return resp as unknown as Response;
    }
    // native fetch — no proxy env inheritance in Bun when proxy is not set
    return await fetch(url, fetchOptions);
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(text: string): string {
  const root = parseHtml(text);
  // remove script and style elements
  for (const el of root.querySelectorAll("script, style")) {
    el.remove();
  }
  const rawText = root.text;
  // collapse excess whitespace
  return rawText.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function webFetch(args: Record<string, unknown>): Promise<string> {
  const url = String(args["url"]);
  const resp = await makeFetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
  }
  const ct = resp.headers.get("content-type") ?? "";
  const text = await resp.text();
  if (ct.includes("html")) {
    return stripHtml(text);
  }
  return text;
}

async function webSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args["query"]);
  const numResults = typeof args["num_results"] === "number" ? (args["num_results"] as number) : 5;
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const resp = await makeFetch(url);
  if (!resp.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${resp.status}`);
  }
  const html = await resp.text();
  const root = parseHtml(html);

  const results: string[] = [];
  for (const result of root.querySelectorAll(".result")) {
    const titleEl = result.querySelector(".result__title a");
    const snippetEl = result.querySelector(".result__snippet");
    if (!titleEl) continue;

    const href = titleEl.getAttribute("href") ?? "";
    const title = titleEl.text.trim();
    const snippet = snippetEl ? snippetEl.text.trim() : "";
    results.push(`[${title}](${href})\n${snippet}`);
    if (results.length >= numResults) break;
  }

  return results.join("\n\n") || "No results found.";
}

export const WEB_FETCH: Tool = makeTool(
  "web_fetch",
  "HTTP GET a URL and return the page text (HTML stripped).",
  {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
    },
    required: ["url"],
  },
  webFetch,
);

export const WEB_SEARCH: Tool = makeTool(
  "web_search",
  "Search DuckDuckGo and return top N results as title + snippet.",
  {
    type: "object",
    properties: {
      query: { type: "string" },
      num_results: { type: "integer", description: "Number of results (default 5)" },
    },
    required: ["query"],
  },
  webSearch,
);

export const WEB_TOOLS: Tool[] = [WEB_FETCH, WEB_SEARCH];
