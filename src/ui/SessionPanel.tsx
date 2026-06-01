import React from "react";
import { Box, Text } from "ink";
import type { SessionView } from "../gateway/index.ts";

interface SessionPanelProps {
  session: SessionView;
}

const MAX_MESSAGES = 10;

export function SessionPanel({ session }: SessionPanelProps): React.ReactElement {
  const recentMessages = session.messages.slice(-MAX_MESSAGES);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={0}>
      <Text bold color="blue">
        {session.channel}:{session.peerId}
      </Text>
      {recentMessages.map((msg, i) => {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        const truncated = content.length > 120 ? content.slice(0, 120) + "…" : content;
        const color =
          msg.role === "user" ? "white" : msg.role === "assistant" ? "green" : "gray";

        return (
          <Box key={i}>
            <Text color={color} dimColor={msg.role === "system"}>
              [{msg.role}] {truncated}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
