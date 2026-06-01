import { ChannelAdapter } from "./base.ts";
import type { OnMessageFn } from "../router.ts";

export class TelegramAdapter extends ChannelAdapter {
  private bot: unknown = null;

  constructor(private readonly token: string) {
    super();
  }

  async start(onMessage: OnMessageFn): Promise<void> {
    const { Bot } = await import("grammy");

    const bot = new (Bot as new (token: string) => {
      on(event: string, handler: (ctx: Record<string, unknown>) => Promise<void>): void;
      start(): Promise<void>;
      api: { sendMessage(chatId: number, text: string): Promise<unknown> };
    })(this.token);

    this.bot = bot;

    bot.on("message:text", async (ctx: Record<string, unknown>) => {
      const msg = ctx["message"] as Record<string, unknown> | undefined;
      if (!msg) return;
      const text = msg["text"] as string | undefined;
      if (!text) return;
      const chatId = msg["chat_id"] as number | undefined ?? (msg["chat"] as Record<string, unknown>)?.["id"] as number;
      const peerId = String(chatId);

      await onMessage("telegram", peerId, text, async (_pid: string, chunk: string) => {
        await bot.api.sendMessage(chatId, chunk);
      });
    });

    console.log("Telegram adapter starting (polling)");
    await bot.start();
  }

  async send(peerId: string, text: string): Promise<void> {
    if (this.bot) {
      const b = this.bot as { api: { sendMessage(chatId: number, text: string): Promise<unknown> } };
      await b.api.sendMessage(parseInt(peerId, 10), text);
    }
  }
}
