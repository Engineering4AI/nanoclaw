import type { Message, ContentBlock } from "../providers/base.ts";
import type { Provider } from "../providers/base.ts";

const CHARS_PER_TOKEN = 4;
const COMPACT_THRESHOLD = 0.8;

function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    const { content } = msg;
    if (typeof content === "string") {
      total += Math.floor(content.length / CHARS_PER_TOKEN);
    } else {
      for (const block of content as ContentBlock[]) {
        total += Math.floor(JSON.stringify(block).length / CHARS_PER_TOKEN);
      }
    }
  }
  return total;
}

export function needsCompaction(messages: Message[], contextWindow: number): boolean {
  return estimateTokens(messages) > contextWindow * COMPACT_THRESHOLD;
}

export async function compact(
  messages: Message[],
  provider: Provider,
  model: string,
): Promise<Message[]> {
  if (messages.length < 6) return messages;

  const system = messages[0]?.role === "system" ? messages[0] : null;
  const body = system ? messages.slice(1) : messages;
  const keepTail = body.slice(-4);
  const toSummarize = body.slice(0, -4);

  if (toSummarize.length === 0) return messages;

  console.log(`Compacting ${toSummarize.length} messages into summary`);

  const summaryText = toSummarize
    .map((m) => {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${m.role}]: ${c}`;
    })
    .join("\n");

  const summaryPrompt: Message[] = [
    {
      role: "user",
      content:
        "Summarize the following conversation into a single paragraph that captures " +
        "all key facts, decisions, and context needed to continue the task:\n\n" +
        summaryText,
    },
  ];

  const resp = await provider.stream(summaryPrompt, [], model);
  const summaryMsg: Message = {
    role: "user",
    content: `[SUMMARY OF EARLIER CONVERSATION]\n${resp.text}`,
  };

  const result: Message[] = [];
  if (system) result.push(system);
  result.push(summaryMsg);
  result.push(...keepTail);
  return result;
}
