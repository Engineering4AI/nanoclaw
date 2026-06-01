import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { EventEmitter } from "events";
import type { GatewayState } from "../gateway/index.ts";
import { StatusBar } from "./StatusBar.tsx";
import { SessionPanel } from "./SessionPanel.tsx";

interface AppProps {
  gateway: GatewayState;
  events: EventEmitter;
}

export function App({ gateway: initialGateway, events }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [gateway, setGateway] = useState<GatewayState>(initialGateway);

  useEffect(() => {
    const handler = (state: GatewayState): void => {
      setGateway({ ...state });
    };
    events.on("update", handler);
    return () => {
      events.off("update", handler);
    };
  }, [events]);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <StatusBar
        model={gateway.model}
        mode={gateway.permissionMode}
        startTime={gateway.startTime}
        activePeers={gateway.sessions.length}
      />
      {gateway.sessions.length === 0 ? (
        <Box paddingX={1}>
          <Text dimColor>Waiting for messages…</Text>
        </Box>
      ) : (
        gateway.sessions.map((s) => <SessionPanel key={s.id} session={s} />)
      )}
      <Box paddingX={1}>
        <Text dimColor>Press q or Esc to quit</Text>
      </Box>
    </Box>
  );
}
