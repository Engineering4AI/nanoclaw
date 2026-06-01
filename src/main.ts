/**
 * NanoClaw entry point — `bun run src/main.ts` or `bun src/main.ts`
 * Mirrors python -m nanoclaw
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";

// Load .env before anything else
function loadDotenv(): void {
  const candidates = [join(process.cwd(), ".env"), join(homedir(), ".nanoclaw", ".env")];
  for (const envFile of candidates) {
    if (!existsSync(envFile)) continue;
    const lines = readFileSync(envFile, "utf-8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eqIdx = line.indexOf("=");
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      // strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      } else {
        // strip inline comments
        val = val.split(" #")[0]!.split("\t#")[0]!.trim();
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
    break; // use only the first found .env
  }
}

loadDotenv();

import { loadConfig } from "./config.ts";
import { start } from "./gateway/index.ts";
import type { ChannelAdapter } from "./gateway/adapters/base.ts";
import type { GatewayState } from "./gateway/index.ts";

function isRealToken(val: string | undefined): val is string {
  if (!val) return false;
  // reject placeholder values like "your-telegram-bot-token" or "xoxb-..."
  if (val.startsWith("your-") || val.includes("<") || val.includes(" ")) return false;
  return true;
}

function buildAdapters(): ChannelAdapter[] {
  const adapters: ChannelAdapter[] = [];

  if (isRealToken(process.env["TELEGRAM_TOKEN"])) {
    // Dynamic import to allow running without grammy installed
    const { TelegramAdapter } = require("./gateway/adapters/telegram.ts") as {
      TelegramAdapter: new (token: string) => ChannelAdapter;
    };
    adapters.push(new TelegramAdapter(process.env["TELEGRAM_TOKEN"]));
  }

  if (isRealToken(process.env["SLACK_BOT_TOKEN"]) && isRealToken(process.env["SLACK_APP_TOKEN"])) {
    const { SlackAdapter } = require("./gateway/adapters/slack.ts") as {
      SlackAdapter: new (botToken: string, appToken: string) => ChannelAdapter;
    };
    adapters.push(new SlackAdapter(process.env["SLACK_BOT_TOKEN"], process.env["SLACK_APP_TOKEN"]));
  }

  if (isRealToken(process.env["DISCORD_TOKEN"])) {
    const { DiscordAdapter } = require("./gateway/adapters/discord.ts") as {
      DiscordAdapter: new (token: string) => ChannelAdapter;
    };
    adapters.push(new DiscordAdapter(process.env["DISCORD_TOKEN"]));
  }

  return adapters;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const adapters = buildAdapters();

  if (!config.apiKey) {
    console.error(
      "No LLM key found. Set OPENROUTER_API_KEY (default), ANTHROPIC_API_KEY, or OPENAI_API_KEY.",
    );
    process.exit(1);
  }

  if (adapters.length === 0) {
    console.error(
      "No adapters configured. Set TELEGRAM_TOKEN, SLACK_BOT_TOKEN/SLACK_APP_TOKEN, or DISCORD_TOKEN.",
    );
    process.exit(1);
  }

  const isTTY = process.stdout.isTTY;

  if (isTTY) {
    // Launch React Ink UI alongside the gateway
    const gatewayState: GatewayState = {
      model: config.model,
      permissionMode: config.permissionMode,
      startTime: new Date(),
      sessions: [],
    };
    const events = new EventEmitter();

    // Start Ink UI in background
    (async () => {
      try {
        const React = (await import("react")).default;
        const { render } = await import("ink");
        const { App } = await import("./ui/App.tsx");

        render(React.createElement(App, { gateway: gatewayState, events }));
      } catch (err) {
        console.warn("Could not start Ink UI:", err);
      }
    })().catch(() => {});

    console.log(`NanoClaw starting — model: ${config.model}, mode: ${config.permissionMode}`);
    await start(config, adapters);
  } else {
    // Non-interactive: just start gateway with console logging
    console.log(`NanoClaw starting — model: ${config.model}, mode: ${config.permissionMode}`);
    await start(config, adapters);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
