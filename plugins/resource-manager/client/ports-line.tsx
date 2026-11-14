import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import type { Port } from "../shared/rpc.js";
import { portAddress, portLabel, reachText } from "./format.js";
import type { ScreenStyles } from "./styles.js";

const HIT_SLOP = 6;

interface PortChipProps {
  port: Port;
  styles: ScreenStyles;
}

function PortChip({ port, styles }: PortChipProps) {
  const toast = useToast();
  const copy = useCallback(() => {
    const address = portAddress(port);
    void copyText(address).then(
      () => toast.show(`Copied ${address}`),
      () => toast.error(`Could not copy ${address}`),
    );
  }, [port, toast]);
  return (
    <Pressable
      onPress={copy}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={portLabel(port)}
      style={styles.portChip}
    >
      <Text style={styles.portNumber}>{port.port}</Text>
      <Text style={styles.portReach}>{reachText(port.reach)}</Text>
    </Pressable>
  );
}

interface PortsLineProps {
  ports: readonly Port[];
  /** Whose ports they are, for the list's name. */
  who: string;
  styles: ScreenStyles;
}

/** The TCP ports an agent's or a group's processes listen on. A tap copies the port's address. */
export function PortsLine({ ports, who, styles }: PortsLineProps) {
  if (ports.length === 0) return null;
  return (
    <View style={styles.ports} accessibilityLabel={`Ports of ${who}`}>
      <Text style={styles.portsTitle}>Listening on</Text>
      <View style={styles.portChips}>
        {ports.map((port) => (
          <PortChip key={port.port} port={port} styles={styles} />
        ))}
      </View>
    </View>
  );
}
