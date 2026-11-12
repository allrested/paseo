import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { stateLabel } from "./agent-card.js";
import { agentMeta, agentTitle, dotTone, type OfficeRoom, type OfficeRow } from "./model.js";
import { PermissionActions } from "./permission-actions.js";
import { RoomBoard } from "./room-board.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

/** Lit is under a finger or a pointer. */
function rowStyle(styles: OfficeStyles, child: boolean, lit: boolean) {
  if (child) return lit ? styles.rowChildPressed : styles.rowChild;
  return lit ? styles.rowPressed : styles.row;
}

function wrapperStyle(styles: OfficeStyles, child: boolean, endsGroup: boolean) {
  if (!child) return styles.rowDivider;
  return endsGroup ? styles.rowGroupEnd : undefined;
}

interface AgentRowProps {
  row: OfficeRow;
  /** The last child of its parent. */
  endsGroup: boolean;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelect(agentId: string): void;
  onOpenSession: ((agentId: string) => void) | undefined;
}

function AgentRow({ row, endsGroup, styles, actions, onSelect, onOpenSession }: AgentRowProps) {
  const { agent } = row;
  const child = row.depth === 1;
  const press = useCallback(() => onSelect(agent.id), [agent.id, onSelect]);
  const openSession = useCallback(() => onOpenSession?.(agent.id), [agent.id, onOpenSession]);
  // The row styles itself and holds no other pressable: its requests sit beside it, not in it.
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  const title = agentTitle(agent);
  const tone = dotTone(agent);
  const state = stateLabel(agent);
  return (
    <View style={wrapperStyle(styles, child, endsGroup)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${state}`}
        onPress={press}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={rowStyle(styles, child, lit)}
      >
        {lit ? <View style={styles.pressedFill} /> : null}
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
              onOpenSession={onOpenSession ? openSession : undefined}
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
  name(author: string): string;
  onSelectAgent(agentId: string): void;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenBoard(roomId: string): void;
}

function RoomCard({
  room,
  styles,
  actions,
  name,
  onSelectAgent,
  onOpenSession,
  onOpenBoard,
}: RoomCardProps) {
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
      {room.rows.map((row, index) => (
        <AgentRow
          key={row.agent.id}
          row={row}
          endsGroup={row.depth === 1 && room.rows[index + 1]?.depth !== 1}
          styles={styles}
          actions={actions}
          onSelect={onSelectAgent}
          onOpenSession={onOpenSession}
        />
      ))}
      <RoomBoard room={room} name={name} styles={styles} onOpenBoard={onOpenBoard} />
    </View>
  );
}

export interface StructureViewProps {
  rooms: readonly OfficeRoom[];
  styles: OfficeStyles;
  actions: AgentActions;
  /** How a post names its author, its claimer and the agent it is for. */
  name(author: string): string;
  onSelectAgent(agentId: string): void;
  /** Opens an agent's session from its row. Absent on a host that gives no navigation. */
  onOpenSession?(agentId: string): void;
  onOpenBoard(roomId: string): void;
}

/** The office as cards: one per room, the lobby first (or the tab's own room). */
export function StructureView({
  rooms,
  styles,
  actions,
  name,
  onSelectAgent,
  onOpenSession,
  onOpenBoard,
}: StructureViewProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          styles={styles}
          actions={actions}
          name={name}
          onSelectAgent={onSelectAgent}
          onOpenSession={onOpenSession}
          onOpenBoard={onOpenBoard}
        />
      ))}
    </ScrollView>
  );
}
