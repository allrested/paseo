import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { agentTitle, buildOfficeModel, dotTone } from "../shared/model.js";
import { loadProblem, Pill } from "./activity-panel.js";
import { stateLabel } from "./agent-card.js";
import { LIST_TABS, NO_MATCH, SEARCH_LABEL, tabCounts, type ListTab } from "./list-text.js";
import { linkSelect } from "./office-link.js";
import { NO_AGENTS, sessionRows, type SessionRow } from "./sessions-text.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useOffice } from "./use-office.js";

type Navigation = PluginScreenProps["navigation"];

interface AgentRowProps {
  entry: SessionRow;
  /** The last sub-agent of its parent. */
  endsGroup: boolean;
  navigation: Navigation;
  styles: OfficeStyles;
}

function AgentRow({ entry, endsGroup, navigation, styles }: AgentRowProps) {
  const { row, room } = entry;
  const { agent } = row;
  const child = row.depth === 1;
  const press = useCallback(() => linkSelect(agent.id, navigation), [agent.id, navigation]);
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
  let wrapper = child ? undefined : styles.rowDivider;
  if (child && endsGroup) wrapper = styles.rowGroupEnd;
  return (
    <View style={wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${state}`}
        onPress={press}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={child ? styles.rowChild : styles.row}
      >
        {lit ? <View style={styles.pressedFill} /> : null}
        <View style={styles.lead}>
          <View style={styles.dot[tone]} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {room.name}
          </Text>
          {row.activity ? (
            <Text style={styles.rowActivity} numberOfLines={1}>
              {row.activity}
            </Text>
          ) : (
            <Text style={styles.rowState[tone]} numberOfLines={1}>
              {state}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

/**
 * The Sessions screen, beside the floor or on its own route: every agent in one list, under the
 * List view's tabs and search.
 */
export function SessionsPanel({ theme, layout, navigation }: PluginScreenProps) {
  // The side area always passes compact, which sizes every control for touch on its own.
  const styles = useOfficeStyles(theme, layout.compact, false);
  const { state, loaded, subscription } = useOffice();
  const [tab, setTab] = useState<ListTab>("all");
  const [query, setQuery] = useState("");
  const model = useMemo(() => buildOfficeModel(state), [state]);
  // The counts ignore the search, as the List view's do.
  const counts = useMemo(() => tabCounts(model.rooms.flatMap((room) => room.rows)), [model]);
  const shown = useMemo(() => sessionRows(model, tab, query), [model, tab, query]);
  const problem = loadProblem(subscription);
  let status: string | null = null;
  if (!loaded) status = problem === null ? "Loading..." : null;
  else if (counts.all === 0) status = NO_AGENTS;
  else if (shown.length === 0) status = NO_MATCH;
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.panelFeed}>
        <View style={styles.panelTop}>
          <View role="group" aria-label="Sessions" style={styles.panelChips}>
            {LIST_TABS.map(({ tab: each, label }) => (
              <Pill<ListTab>
                key={each}
                value={each}
                label={label}
                name={`${label}, ${counts[each]}`}
                count={counts[each]}
                on={each === tab}
                toggle={false}
                onPress={setTab}
                styles={styles}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel={SEARCH_LABEL}
            placeholder={SEARCH_LABEL}
            placeholderTextColor={styles.placeholderColor}
            value={query}
            onChangeText={setQuery}
            style={styles.pickerSearch}
          />
        </View>
        {problem === null ? null : (
          <View style={styles.bannerSlot}>
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.bannerText}>
                {problem}
              </Text>
            </View>
          </View>
        )}
        {status === null ? null : <Text style={styles.sceneStatus}>{status}</Text>}
        {shown.map((entry, index) => (
          <AgentRow
            key={entry.row.agent.id}
            entry={entry}
            endsGroup={entry.row.depth === 1 && shown[index + 1]?.row.depth !== 1}
            navigation={navigation}
            styles={styles}
          />
        ))}
      </ScrollView>
    </View>
  );
}
