import { ChannelAdapter } from "./base.ts";
import type { OnMessageFn } from "../router.ts";

export class DiscordAdapter extends ChannelAdapter {
  private discordClient: unknown = null;

  constructor(private readonly token: string) {
    super();
  }

  async start(onMessage: OnMessageFn): Promise<void> {
    const { Client, GatewayIntentBits } = await import("discord.js");

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.discordClient = client;

    client.on("messageCreate", async (message: Record<string, unknown>) => {
      const author = message["author"] as Record<string, unknown>;
      if (author["bot"]) return;

      const peerId = String(author["id"]);
      const content = (message["content"] as string | undefined) ?? "";

      const channel = message["channel"] as { send(text: string): Promise<unknown> };

      await onMessage("discord", peerId, content, async (_pid: string, chunk: string) => {
        await channel.send(chunk);
      });
    });

    console.log("Discord adapter starting");
    await client.login(this.token);

    // keep alive
    await new Promise<void>(() => {
      // never resolves — discord.js keeps event loop alive
    });
  }

  async send(_peerId: string, _text: string): Promise<void> {
    // Discord requires a channel reference; use deliver() in onMessage instead
  }
}
