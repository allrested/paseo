import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import {
  runRpc,
  type LoadedRun,
  type RunAgent,
  type RunView,
  type WorkflowItem,
} from "../shared/run.js";
import {
  AGENT_STATE_LABELS,
  NO_AGENTS,
  RUN_STATE_LABELS,
  describeAgent,
  groupByPhase,
  isCardOpen,
  loadedRun,
  pollInterval,
  refreshNote,
  statusLine,
  summaryText,
  type PhaseGroup,
} from "./format.js";
import { useCardStyles, type CardStyles } from "./styles.js";

/** The live card that takes the place of a `Workflow` tool card. */
export function WorkflowCard({ agentId, item, theme }: PluginTimelineItemProps<WorkflowItem>) {
  const styles = useCardStyles(theme);
  const { runId, summary } = item.data;
  const fetchRun = useRpc(runRpc);
  // The interval belongs to the query observer, so polling stops when the card unmounts or the
  // run leaves Running. No retry: a loaded card's next poll is the retry, and a failed first
  // load waits for the next mount or the page turning visible.
  const run = useQuery({
    queryKey: ["claude-workflows", "run", agentId, runId],
    queryFn: () => fetchRun({ agentId, runId }),
    refetchInterval: (query) => pollInterval(query.state.data),
    retry: false,
  });
  const view = run.data;
  const loaded = loadedRun(view);
  // Null until the user taps: the card then follows the run, open only while it is Running.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = isCardOpen(loaded, chosen);
  const toggle = useCallback(() => setChosen(!open), [open]);
  const expanded = useMemo(() => ({ expanded: open }), [open]);
  // Ages and elapsed time move when a poll lands, not on a timer of their own.
  const now = run.dataUpdatedAt;
  const status = statusLine({ view, failed: run.isError, now });
  const refreshFailed = refreshNote(view, run.isError);
  const title = summaryText(summary, view);
  return (
    <View style={styles.card} testID="claude-workflow-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={expanded}
        disabled={loaded === null}
        onPress={toggle}
        style={styles.header}
      >
        <View style={styles.titleRow}>
          {loaded === null ? null : (
            <Icon
              name={open ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
          )}
          <Text style={styles.title}>Workflow</Text>
          <Text style={styles.runId}>{runId}</Text>
          {view === undefined ? null : <StateChip state={view.state} styles={styles} />}
        </View>
        {title === null ? null : (
          <Text numberOfLines={2} style={styles.summary}>
            {title}
          </Text>
        )}
        <Text style={styles.meta}>
          {status}
          {refreshFailed === null ? null : (
            <Text style={styles.error}>{` · ${refreshFailed}`}</Text>
          )}
        </Text>
      </Pressable>
      {open && loaded !== null ? <RunBody run={loaded} now={now} styles={styles} /> : null}
    </View>
  );
}

interface StateChipProps {
  state: RunView["state"];
  styles: CardStyles;
}

function StateChip({ state, styles }: StateChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText[state]}>{RUN_STATE_LABELS[state]}</Text>
    </View>
  );
}

interface RunBodyProps {
  run: LoadedRun;
  now: number;
  styles: CardStyles;
}

function RunBody({ run, now, styles }: RunBodyProps) {
  const groups = useMemo(() => groupByPhase(run.agents), [run.agents]);
  if (groups.length === 0) return <Text style={styles.meta}>{NO_AGENTS}</Text>;
  return (
    <View style={styles.body}>
      {groups.map((group) => (
        <PhaseSection key={group.phase} group={group} now={now} styles={styles} />
      ))}
    </View>
  );
}

interface PhaseSectionProps {
  group: PhaseGroup;
  now: number;
  styles: CardStyles;
}

function PhaseSection({ group, now, styles }: PhaseSectionProps) {
  return (
    <View style={styles.phase}>
      {group.phase === "" ? null : <Text style={styles.phaseTitle}>{group.phase}</Text>}
      {group.agents.map((agent) => (
        <AgentRow key={agent.key} agent={agent} now={now} styles={styles} />
      ))}
    </View>
  );
}

interface AgentRowProps {
  agent: RunAgent;
  now: number;
  styles: CardStyles;
}

function AgentRow({ agent, now, styles }: AgentRowProps) {
  const metaStyle = agent.state === "unreadable" ? styles.error : styles.meta;
  return (
    <View style={styles.agent}>
      <View style={styles.agentTitleRow}>
        <Text style={styles.agentState[agent.state]}>{AGENT_STATE_LABELS[agent.state]}</Text>
        <Text numberOfLines={1} style={styles.agentLabel}>
          {agent.label}
        </Text>
      </View>
      <Text style={metaStyle}>{describeAgent(agent, now)}</Text>
    </View>
  );
}
