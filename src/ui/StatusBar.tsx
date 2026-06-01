import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  model: string;
  mode: string;
  startTime: Date;
  activePeers: number;
}

function formatUptime(startTime: Date): string {
  const ms = Date.now() - startTime.getTime();
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

export function StatusBar({ model, mode, startTime, activePeers }: StatusBarProps): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold>NanoClaw</Text>
      <Text> | </Text>
      <Text color="cyan">{model}</Text>
      <Text> | </Text>
      <Text color="yellow">{mode}</Text>
      <Text> | </Text>
      <Text>uptime: {formatUptime(startTime)}</Text>
      <Text> | </Text>
      <Text color="green">{activePeers} peer{activePeers !== 1 ? "s" : ""}</Text>
    </Box>
  );
}
