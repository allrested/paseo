import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { OfficeAgent } from "../shared/contracts.js";
import { STATUS_LABELS } from "./agent-card.js";
import { reasonLabel } from "./attention-strip.js";
import {
  agentMeta,
  agentTitle,
  attentionReason,
  dotTone,
  type OfficeRoom,
  type OfficeRow,
} from "./model.js";
import { PermissionActions } from "./permission-actions.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

/** The agent's state in words, so it does not rest on the dot's colour. */
function stateLabel(agent: OfficeAgent): string {
  const reason = attentionReason(agent);
  return reason === null ? STATUS_LABELS[agent.status] : reasonLabel(reason);
}

function rowStyle(styles: OfficeStyles, child: boolean, pressed: boolean) {
  if (child) return pressed ? styles.rowChildPressed : styles.rowChild;
  return pressed ? styles.rowPressed : styles.row;
}

interface AgentRowProps {
  row: OfficeRow;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelect(agentId: string): void;
}

function AgentRow({ row, styles, actions, onSelect }: AgentRowProps) {
  const { agent } = row;
  const child = row.depth === 1;
  const press = useCallback(() => onSelect(agent.id), [agent.id, onSelect]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => rowStyle(styles, child, pressed),
    [styles, child],
  );
  const title = agentTitle(agent);
  const tone = dotTone(agent);
  const state = stateLabel(agent);
  return (
    <View style={child ? undefined : styles.rowDivider}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${state}`}
        onPress={press}
        style={pressableStyle}
      >
        <View style={styles.lead}>
          <View style={styles.dot[tone]} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowHeading}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            {/* Idle is the quiet state: its dot is enough, and the label would repeat down the list. */}
            {tone === "idle" ? null : <Text style={styles.rowState[tone]}>{state}</Text>}
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {agentMeta(agent)}
          </Text>
          {row.activity ? (
            <Text style={styles.rowActivity} numberOfLines={1}>
              {row.activity}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {agent.permissions.length > 0 ? (
        <View style={child ? styles.rowChildPermissions : styles.rowPermissions}>
          {agent.permissions.map((permission) => (
            <PermissionActions
              key={permission.id}
              agentId={agent.id}
              permission={permission}
              actions={actions}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface RoomCardProps {
  room: OfficeRoom;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
}

function RoomCard({ room, styles, actions, onSelectAgent }: RoomCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {room.name}
        </Text>
        {room.subtitle ? (
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {room.subtitle}
          </Text>
        ) : null}
      </View>
      {room.rows.length === 0 ? <Text style={styles.empty}>No agents</Text> : null}
      {room.rows.map((row) => (
        <AgentRow
          key={row.agent.id}
          row={row}
          styles={styles}
          actions={actions}
          onSelect={onSelectAgent}
        />
      ))}
    </View>
  );
}

export interface StructureViewProps {
  rooms: readonly OfficeRoom[];
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
}

/** The office as cards: one per room, the lobby first (or the tab's own room). */
export function StructureView({ rooms, styles, actions, onSelectAgent }: StructureViewProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          styles={styles}
          actions={actions}
          onSelectAgent={onSelectAgent}
        />
      ))}
    </ScrollView>
  );
}
