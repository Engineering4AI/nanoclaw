import { ChannelAdapter } from "./base.ts";
import type { OnMessageFn } from "../router.ts";

export class SlackAdapter extends ChannelAdapter {
  private client: unknown = null;

  constructor(
    private readonly botToken: string,
    private readonly appToken: string,
  ) {
    super();
  }

  async start(onMessage: OnMessageFn): Promise<void> {
    const { App } = await import("@slack/bolt");
    const { SocketModeReceiver } = await import("@slack/bolt");

    const app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
    });

    this.client = app.client;

    app.message(async ({ event, say }: Record<string, unknown>) => {
      const ev = event as Record<string, unknown>;
      if (ev["bot_id"]) return;
      const peerId = ev["user"] as string | undefined;
      if (!peerId) return;
      const text = (ev["text"] as string | undefined) ?? "";
      const channel = ev["channel"] as string;

      await onMessage("slack", peerId, text, async (_pid: string, chunk: string) => {
        await (say as (opts: Record<string, unknown>) => Promise<void>)({ text: chunk, channel });
      });
    });

    console.log("Slack adapter starting (socket mode)");
    await app.start();
  }

  async send(peerId: string, text: string): Promise<void> {
    if (this.client) {
      const c = this.client as { chat: { postMessage(opts: Record<string, unknown>): Promise<unknown> } };
      await c.chat.postMessage({ channel: peerId, text });
    }
  }
}
