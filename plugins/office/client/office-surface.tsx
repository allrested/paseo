import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { AgentCard } from "./agent-card.js";
import { AttentionStrip } from "./attention-strip.js";
import { buildOfficeModel, orderRoomsForFocus, type OfficeRoom } from "./model.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useOffice, type OfficeState } from "./use-office.js";

export type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

interface SurfaceBodyProps {
  office: OfficeState;
  rooms: readonly OfficeRoom[];
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
}

function SurfaceBody({ office, rooms, styles, actions, onSelectAgent }: SurfaceBodyProps) {
  if (office.subscription.status === "error") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to load the office: {office.subscription.error.message}
      </Text>
    );
  }
  // Closed means the plugin's handler finished, and the hook does not subscribe again: without
  // this the rows would stay on screen and never change.
  if (office.subscription.status === "closed") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to show live agents: the host closed the office. Reopen it
      </Text>
    );
  }
  if (!office.loaded) return <Text style={styles.sceneStatus}>Loading...</Text>;
  return (
    <StructureView rooms={rooms} styles={styles} actions={actions} onSelectAgent={onSelectAgent} />
  );
}

/** One surface for both places: the sidebar screen and a workspace tab. */
export function OfficeSurface(props: OfficeSurfaceProps) {
  const { theme, layout, navigation } = props;
  const focusRoomId = "workspaceId" in props ? props.workspaceId : null;
  const styles = useOfficeStyles(theme, layout.compact);
  const office = useOffice();
  const actions = useAgentActions();
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
  const selected = selectedId === null ? null : (model.agents.get(selectedId) ?? null);
  const selectedActivity = selectedId === null ? null : (office.state.activity[selectedId] ?? null);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <AttentionStrip entries={model.attention} styles={styles} onSelect={setSelectedId} />
      </View>
      <SurfaceBody
        office={office}
        rooms={rooms}
        styles={styles}
        actions={actions}
        onSelectAgent={setSelectedId}
      />
      <AgentCard
        agent={selected}
        activity={selectedActivity}
        actions={actions}
        navigation={navigation}
        styles={styles}
        onClose={closeCard}
      />
    </View>
  );
}
