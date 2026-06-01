import type { OnMessageFn } from "../router.ts";

export abstract class ChannelAdapter {
  abstract start(onMessage: OnMessageFn): Promise<void>;
  abstract send(peerId: string, text: string): Promise<void>;
}
