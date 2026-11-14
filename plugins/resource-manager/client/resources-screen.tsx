import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { serversRpc, type ServerEntry } from "../shared/rpc.js";
import type { CardsState } from "./card-views.js";
import {
  EMPTY_OPEN,
  EMPTY_TREND,
  recordTrend,
  setAllOpen,
  toggleOpen,
  type TrendSample,
} from "./cards.js";
import { InstanceTab } from "./instance-tab.js";
import { ServerTab } from "./server-tab.js";
import { StackTab } from "./stack-tab.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

const INSTANCE_TAB = "instance";
const STACK_TAB = "stack";
const NO_SERVERS: readonly ServerEntry[] = [];
const NO_PROBLEMS: readonly string[] = [];
const SELECTED = { selected: true };
const UNSELECTED = { selected: false };

interface TabButtonProps {
  id: string;
  label: string;
  selected: boolean;
  onSelect(id: string): void;
  styles: ScreenStyles;
}

interface TabBarProps {
  servers: readonly ServerEntry[];
  selected: string;
  onSelect(id: string): void;
  styles: ScreenStyles;
}

function TabButton({ id, label, selected, onSelect, styles }: TabButtonProps) {
  const press = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={selected ? SELECTED : UNSELECTED}
      onPress={press}
      style={selected ? styles.tabSelected : styles.tab}
    >
      <Text style={selected ? styles.tabLabelSelected : styles.tabLabel}>{label}</Text>
    </Pressable>
  );
}

function TabBar({ servers, selected, onSelect, styles }: TabBarProps) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      <TabButton
        id={INSTANCE_TAB}
        label="This instance"
        selected={selected === INSTANCE_TAB}
        onSelect={onSelect}
        styles={styles}
      />
      <TabButton
        id={STACK_TAB}
        label="Stack"
        selected={selected === STACK_TAB}
        onSelect={onSelect}
        styles={styles}
      />
      {servers.map((server) => (
        <TabButton
          key={server.id}
          id={server.id}
          label={server.name}
          selected={selected === server.id}
          onSelect={onSelect}
          styles={styles}
        />
      ))}
    </View>
  );
}

// Held by the screen, not a tab: a tab unmounts when another is selected, and its open cards and
// trend should be there when the user comes back. Gone when the screen closes.
function useCards(): CardsState {
  const [open, setOpen] = useState(EMPTY_OPEN);
  const [trend, setTrend] = useState(EMPTY_TREND);
  const toggle = useCallback((id: string) => setOpen((current) => toggleOpen(current, id)), []);
  const setAll = useCallback(
    (ids: readonly string[], value: boolean) =>
      setOpen((current) => setAllOpen(current, ids, value)),
    [],
  );
  // recordTrend returns the history it was given when no reading is new, so this does not loop.
  const record = useCallback(
    (samples: readonly TrendSample[]) => setTrend((current) => recordTrend(current, samples)),
    [],
  );
  return useMemo(
    () => ({ open, trend, toggle, setAll, record }),
    [open, trend, toggle, setAll, record],
  );
}

export function ResourcesScreen({ theme, host }: PluginScreenProps) {
  const styles = useScreenStyles(theme);
  const fetchServers = useRpc(serversRpc);
  const [selected, setSelected] = useState(INSTANCE_TAB);
  const cards = useCards();
  // Fetched once per visit (decision 17): a config change shows on the next visit.
  const list = useQuery({
    queryKey: ["resource-manager", host.id, "servers"],
    queryFn: () => fetchServers({}),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const servers = list.data?.servers ?? NO_SERVERS;
  const problems = list.data?.problems ?? NO_PROBLEMS;
  const current = servers.find((server) => server.id === selected);
  let shown = INSTANCE_TAB;
  if (current !== undefined || selected === STACK_TAB) shown = selected;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TabBar servers={servers} selected={shown} onSelect={setSelected} styles={styles} />
      {list.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to list ssh-mcp servers: {list.error.message}
        </Text>
      ) : null}
      {problems.map((problem) => (
        <Text key={problem} style={styles.muted}>
          {problem}
        </Text>
      ))}
      {shown === INSTANCE_TAB ? (
        <InstanceTab hostId={host.id} cards={cards} styles={styles} />
      ) : null}
      {shown === STACK_TAB ? <StackTab hostId={host.id} cards={cards} styles={styles} /> : null}
      {current === undefined ? null : (
        <ServerTab
          key={current.id}
          server={current}
          hostId={host.id}
          cards={cards}
          styles={styles}
        />
      )}
    </ScrollView>
  );
}
