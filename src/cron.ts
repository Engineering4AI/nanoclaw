import { run as agentRun } from "./agent/loop.ts";
import type { Config } from "./config.ts";
import { PermissionPolicy } from "./permissions.ts";

export interface CronJob {
  schedule: string; // cron expression: "*/5 * * * *" or interval like "5m", "1h"
  prompt: string;
  channel?: string; // tag for logs
}

function parseCronEnv(raw: string): CronJob[] {
  // Format: "SCHEDULE|PROMPT[|CHANNEL], SCHEDULE|PROMPT[|CHANNEL], ..."
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split("|").map((p) => p.trim());
      if (parts.length < 2) throw new Error(`Invalid NANOCLAW_CRON entry: "${entry}" — expected "SCHEDULE|PROMPT"`);
      return { schedule: parts[0]!, prompt: parts[1]!, channel: parts[2] };
    });
}

// Parse "30s", "5m", "2h" → milliseconds. Falls back to cron-style interval parsing.
function intervalMs(schedule: string): number {
  const m = schedule.match(/^(\d+)(s|m|h)$/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (m[2] === "s") return n * 1000;
    if (m[2] === "m") return n * 60_000;
    return n * 3_600_000;
  }
  // Minimal cron parsing: "*/N * * * *" → every N minutes
  const cronMinute = schedule.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (cronMinute) return parseInt(cronMinute[1]!, 10) * 60_000;
  // "0 */N * * *" → every N hours
  const cronHour = schedule.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (cronHour) return parseInt(cronHour[1]!, 10) * 3_600_000;
  // "0 N * * *" → daily at hour N (compute ms until next fire, then repeat 24h)
  const cronDaily = schedule.match(/^0\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (cronDaily) return 24 * 3_600_000; // simplified: repeat daily, fire immediately once
  throw new Error(`Unsupported cron schedule: "${schedule}". Use "Nm"/"Nh" or "*/N * * * *".`);
}

export class CronScheduler {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly jobs: CronJob[],
    private readonly config: Config,
  ) {}

  start(): void {
    for (const job of this.jobs) {
      const ms = intervalMs(job.schedule);
      const label = job.channel ?? "cron";
      console.log(`[${label}] Cron job scheduled every ${ms / 1000}s: "${job.prompt}"`);

      const fire = async (): Promise<void> => {
        console.log(`[${label}] Firing cron: "${job.prompt}"`);
        const policy = PermissionPolicy.fromMode("auto"); // cron runs unattended
        const messages = [{ role: "user" as const, content: job.prompt }];
        try {
          const result = await agentRun(messages, this.config, { policy });
          console.log(`[${label}] Cron result: ${result.slice(0, 200)}${result.length > 200 ? "…" : ""}`);
        } catch (err) {
          console.error(`[${label}] Cron error:`, err);
        }
      };

      this.timers.push(setInterval(fire, ms));
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}

export { parseCronEnv };
