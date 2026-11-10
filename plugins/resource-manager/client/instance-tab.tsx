import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsRow } from "@getpaseo/plugin/client/ui";
import { closeAgentRpc, isClosableStatus, localRpc, type AgentUsage } from "../shared/rpc.js";
import { DetailBlockView, ResourceCard, TrendBlock, type CardsState } from "./card-views.js";
import {
  agentsSummary,
  formatAge,
  groupsSummary,
  instanceDetails,
  instanceSample,
  instanceSummary,
  trendLines,
  type TrendPoint,
} from "./cards.js";
import { agentLabel, describeAgent, describeGroup, groupLabel } from "./format.js";
import type { ScreenStyles } from "./styles.js";

const POLL_MS = 5_000;
// The SDK has no confirm dialog: the first press arms Close, a second within this window closes.
const CONFIRM_MS = 5_000;
const ARMED_HINT = "Press again within 5 s to end this agent's runtime; its next prompt resumes it";

export function localQueryKey(hostId: string) {
  return ["resource-manager", hostId, "local"] as const;
}

// Card keys among the open cards and in the trend. A server tab's keys start with its id.
const INSTANCE = "instance";
const AGENTS = "instance/agents";
const GROUPS = "instance/groups";
const NO_POINTS: readonly TrendPoint[] = [];

interface InstanceTabProps {
  hostId: string;
  cards: CardsState;
  styles: ScreenStyles;
}

interface AgentRowProps {
  agent: AgentUsage;
  /** The reading's time, for the idle figure. */
  now: number;
  hostId: string;
}

function closeLabel(pending: boolean, armed: boolean): string {
  if (pending) return "Closing...";
  return armed ? "Confirm close" : "Close";
}

function AgentRow({ agent, now, hostId }: AgentRowProps) {
  const callClose = useRpc(closeAgentRpc);
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);
  const close = useMutation({
    mutationFn: () => callClose({ agentId: agent.agentId }),
    // Refetch at once, so the freed memory shows without waiting for the next poll.
    onSettled: () => queryClient.invalidateQueries({ queryKey: localQueryKey(hostId) }),
  });
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const { mutate } = close;
  const press = useCallback(() => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    mutate();
  }, [armed, mutate]);
  const reply = close.data;
  const rejection = reply?.ok === false ? reply.error : null;
  return (
    <SettingsAction
      label={agentLabel(agent)}
      hint={armed ? ARMED_HINT : describeAgent(agent, now)}
      error={close.error?.message ?? rejection}
      actionLabel={closeLabel(close.isPending, armed)}
      disabled={!isClosableStatus(agent.status) || close.isPending}
      onPress={press}
    />
  );
}

export function InstanceTab({ hostId, cards, styles }: InstanceTabProps) {
  const fetchLocal = useRpc(localRpc);
  // The interval belongs to the query observer, so polling stops when the tab unmounts. No
  // retries: the next poll is the retry.
  const reading = useQuery({
    queryKey: localQueryKey(hostId),
    queryFn: () => fetchLocal({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = reading.data;
  const { record } = cards;
  useEffect(() => {
    if (data !== undefined) record([instanceSample(INSTANCE, data.host, data.readAt)]);
  }, [record, data]);
  if (data === undefined) {
    if (reading.isError) {
      return (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to read this instance: {reading.error.message}
        </Text>
      );
    }
    return <Text style={styles.muted}>Reading this instance...</Text>;
  }
  const now = Date.parse(data.readAt);
  const { open, toggle } = cards;
  const instanceOpen = open.has(INSTANCE);
  const summary = instanceSummary(
    data.host,
    reading.isError ? `Refresh failed: ${reading.error.message}` : null,
  );
  const noAgents = data.agents.length === 0;
  return (
    <View style={styles.cards}>
      <ResourceCard
        id={INSTANCE}
        title="This instance"
        meta={formatAge(data.readAt, Math.max(reading.dataUpdatedAt, reading.errorUpdatedAt))}
        summary={summary}
        expandable
        open={instanceOpen}
        onToggle={toggle}
        styles={styles}
      >
        {instanceOpen
          ? instanceDetails(data.host, data.readAt).map((block) => (
              <DetailBlockView key={block.key} block={block} styles={styles} />
            ))
          : null}
        {instanceOpen ? (
          <TrendBlock
            lines={trendLines(cards.trend.get(INSTANCE) ?? NO_POINTS, data.host.cores)}
            styles={styles}
          />
        ) : null}
      </ResourceCard>
      {data.agentsError === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to list agents: {data.agentsError}
        </Text>
      )}
      <ResourceCard
        id={AGENTS}
        title="Agents"
        meta={noAgents && data.agentsError !== null ? "Not available" : agentsSummary(data.agents)}
        summary={null}
        expandable={!noAgents}
        open={open.has(AGENTS)}
        onToggle={toggle}
        styles={styles}
      >
        {data.agents.map((agent) => (
          <AgentRow key={agent.agentId} agent={agent} now={now} hostId={hostId} />
        ))}
      </ResourceCard>
      <ResourceCard
        id={GROUPS}
        title="Groups"
        meta={groupsSummary(data.groups)}
        summary={null}
        expandable={data.groups.length > 0}
        open={open.has(GROUPS)}
        onToggle={toggle}
        styles={styles}
      >
        {data.groups.map((group) => (
          <SettingsRow
            key={group.kind}
            label={groupLabel(group.kind)}
            hint={describeGroup(group)}
          />
        ))}
      </ResourceCard>
    </View>
  );
}
