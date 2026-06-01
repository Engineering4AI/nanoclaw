import type { Config } from "../config.ts";
import type { ChannelAdapter } from "./adapters/base.ts";
import { Router } from "./router.ts";

export interface GatewayConfig {
  resetHour: number;   // daily session reset at 04:00 local
  idleHours: number;   // also reset after N hours idle
  sessionScope: string; // "per-peer" | "per-channel-peer"
  maxChunkChars: number; // for block streaming
}

export interface SessionView {
  id: string;
  peerId: string;
  channel: string;
  messages: Array<{ role: string; content: string }>;
}

export interface GatewayState {
  model: string;
  permissionMode: string;
  startTime: Date;
  sessions: SessionView[];
}

export async function start(config: Config, adapters: ChannelAdapter[]): Promise<void> {
  const router = new Router(config);

  await Promise.all(
    adapters.map((adapter) => adapter.start(router.onMessage.bind(router))),
  );
}
