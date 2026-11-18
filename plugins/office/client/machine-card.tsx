import { useCallback, useMemo } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { Modal } from "@getpaseo/plugin/client/ui";
import type { Machine, MachineAgent } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import {
  agentLine,
  agentRowLabel,
  formatBytes,
  machineTitle,
  memoryPercent,
  memoryText,
  memoryTone,
  readAtText,
  type HostTone,
} from "../shared/machine-text.js";
import type { OfficeStyles } from "./styles.js";

interface MeterProps {
  label: string;
  value: string;
  /** 0 to 100; null draws the track alone. */
  percent: number | null;
  tone: HostTone;
  styles: OfficeStyles;
}

function Meter({ label, value, percent, tone, styles }: MeterProps) {
  const fill = useMemo(
    (): ViewStyle[] => [styles.machineFill[tone], { width: `${percent ?? 0}%` }],
    [styles, tone, percent],
  );
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="text"
      style={styles.machineMeter}
    >
      <Text style={styles.sheetLabel}>{label}</Text>
      <Text style={styles.machineValue}>{value}</Text>
      <View style={styles.machineTrack}>
        <View style={styles.machineTrackBase} />
        {percent === null ? null : <View style={fill} />}
      </View>
    </View>
  );
}

interface AgentRowProps {
  agent: MachineAgent;
  /** The reading's own time. */
  now: number;
  /** The button under the row; null for a row nothing can be done about. */
  action: { label: string; pendingLabel: string; primary: boolean } | null;
  cleanUp(agentIds: readonly string[]): Promise<void>;
  styles: OfficeStyles;
}

function AgentRow({ agent, now, action, cleanUp, styles }: AgentRowProps) {
  const press = useCallback(() => cleanUp([agent.agentId]), [cleanUp, agent.agentId]);
  return (
    <View style={styles.machineRow}>
      <View accessible accessibilityLabel={agentRowLabel(agent, now)} accessibilityRole="text">
        <View style={styles.machineRowHead}>
          <Text style={styles.machineRowTitle} numberOfLines={1}>
            {machineTitle(agent)}
          </Text>
          <Text style={styles.machineValue}>{formatBytes(agent.rssBytes)}</Text>
        </View>
        <Text style={styles.rowMeta}>{agentLine(agent, now)}</Text>
      </View>
      {action ? (
        <View style={styles.actions}>
          <ActionButton
            label={action.label}
            pendingLabel={action.pendingLabel}
            onPress={press}
            styles={styles}
            primary={action.primary}
          />
        </View>
      ) : null}
    </View>
  );
}

interface MachineBodyProps {
  machine: Machine;
  cleanUp(agentIds: readonly string[]): Promise<void>;
  styles: OfficeStyles;
}

// One accent button per sheet (docs/design.md section 3): the row's own when one agent left
// something, the one for all of them when several did.
const CLEAN_ONLY = { label: "Clean up", pendingLabel: "Cleaning up...", primary: true };
const CLEAN_ONE = { label: "Clean up", pendingLabel: "Cleaning up...", primary: false };
const CLOSE = { label: "Close", pendingLabel: "Closing...", primary: false };

function MachineBody({ machine, cleanUp, styles }: MachineBodyProps) {
  const now = Date.parse(machine.readAt);
  const left = useMemo(() => machine.agents.filter((agent) => agent.forgotten), [machine.agents]);
  const others = useMemo(
    () => machine.agents.filter((agent) => !agent.forgotten),
    [machine.agents],
  );
  // A host that cannot close an agent's runtime can still stop what a closed agent left behind.
  const canClose = machine.canCloseRuntime !== false;
  const cleanable = useMemo(
    () => left.filter((agent) => canClose || agent.status === "closed"),
    [left, canClose],
  );
  const cleanAll = useCallback(
    () => cleanUp(cleanable.map((agent) => agent.agentId)),
    [cleanUp, cleanable],
  );
  const percent = memoryPercent(machine);
  const rowAction = cleanable.length === 1 ? CLEAN_ONLY : CLEAN_ONE;
  return (
    <View style={styles.sheet}>
      <View style={styles.machineMeters}>
        <Meter
          label="Memory"
          value={percent === null ? memoryText(machine) : `${memoryText(machine)} (${percent}%)`}
          percent={percent}
          tone={memoryTone(percent)}
          styles={styles}
        />
        <Meter
          label="CPU"
          value={machine.cpuPercent === null ? "Not read yet" : `${machine.cpuPercent}%`}
          percent={machine.cpuPercent}
          tone="muted"
          styles={styles}
        />
      </View>
      {left.length > 0 ? (
        <View style={styles.machineGroup}>
          <Text accessibilityRole="header" style={styles.sheetLabel}>
            Left running
          </Text>
          {left.map((agent) => (
            <AgentRow
              key={agent.agentId}
              agent={agent}
              now={now}
              action={cleanable.includes(agent) ? rowAction : null}
              cleanUp={cleanUp}
              styles={styles}
            />
          ))}
          <Text style={styles.rowMeta}>
            {canClose
              ? "Cleaning up closes an idle agent, which its next prompt resumes, and stops what a closed agent left behind."
              : `This host cannot close an idle agent's runtime.${cleanable.length > 0 ? " Cleaning up stops what a closed agent left behind." : ""}`}
          </Text>
          {cleanable.length > 1 ? (
            <ActionButton
              label={`Clean up all ${cleanable.length}`}
              pendingLabel="Cleaning up..."
              onPress={cleanAll}
              styles={styles}
              primary
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.machineGroup}>
        <Text accessibilityRole="header" style={styles.sheetLabel}>
          Memory by agent
        </Text>
        {others.length === 0 ? (
          <Text style={styles.muted}>
            {left.length === 0
              ? "No agent holds a process on this host."
              : "No other agent holds a process on this host."}
          </Text>
        ) : (
          others.map((agent) => (
            <AgentRow
              key={agent.agentId}
              agent={agent}
              now={now}
              action={canClose && agent.status === "idle" ? CLOSE : null}
              cleanUp={cleanUp}
              styles={styles}
            />
          ))
        )}
      </View>
      <Text style={styles.rowMeta}>Read at {readAtText(machine.readAt)}</Text>
    </View>
  );
}

export interface MachineCardProps {
  /** Null closes the card: the host has no reading (any more). */
  machine: Machine | null;
  open: boolean;
  cleanUp(agentIds: readonly string[]): Promise<void>;
  styles: OfficeStyles;
  onClose(): void;
}

/** The host: its memory, what each agent holds of it, and what was left running. */
export function MachineCard({ machine, open, cleanUp, styles, onClose }: MachineCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Host" open={open && machine !== null} onOpenChange={change}>
      <Modal.Content>
        {machine ? <MachineBody machine={machine} cleanUp={cleanUp} styles={styles} /> : null}
      </Modal.Content>
    </Modal>
  );
}
