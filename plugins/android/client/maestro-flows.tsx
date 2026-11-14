// The workspace's Maestro flows under the device picture: run one, watch it on the device, read
// the result, and hand a failure to an agent. React Native primitives only, as the surface.
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  maestroAgentsRpc,
  maestroFlowsRpc,
  maestroRunSubscription,
  maestroSendRpc,
  maestroStartRpc,
  maestroStopRpc,
  type MaestroRunState,
} from "../shared/contracts.js";
import { Button } from "./button.js";
import type { AndroidStyles } from "./styles.js";

const EMPTY_INPUT = {};

/** "12 s", "3 min 05 s". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/** The result line of a finished run. */
export function runSummary(run: MaestroRunState): string {
  const took = duration((run.endedAt ?? run.startedAt) - run.startedAt);
  if (run.status === "passed") return `Passed · ${took}`;
  if (run.status === "stopped") return `${run.message ?? "Stopped"} · ${took}`;
  return `Failed${run.failedStep ? ` at ${run.failedStep}` : ""} · ${took}`;
}

interface FlowRowProps {
  flow: string;
  running: boolean;
  onRun(flow: string): void;
  styles: AndroidStyles;
}

function FlowRow({ flow, running, onRun, styles }: FlowRowProps) {
  const run = useCallback(() => onRun(flow), [onRun, flow]);
  return (
    <View style={styles.flowRow}>
      <Text style={styles.flowName} numberOfLines={1}>
        {flow}
      </Text>
      {running ? null : <Button label={`Run ${flow}`} onPress={run} styles={styles} />}
    </View>
  );
}

interface SendRowProps {
  run: MaestroRunState;
  workspaceId: string;
  styles: AndroidStyles;
  onDone(message: string): void;
}

function SendRow({ run, workspaceId, styles, onDone }: SendRowProps) {
  const listAgents = useRpc(maestroAgentsRpc);
  const send = useRpc(maestroSendRpc);
  const [agents, setAgents] = useState<{ id: string; title: string }[] | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    listAgents({ workspaceId }).then(
      (answer) => active && setAgents(answer.agents),
      () => active && setAgents([]),
    );
    return () => {
      active = false;
    };
  }, [listAgents, workspaceId]);
  const sendTo = useCallback(
    (agent: { id: string; title: string }) => {
      send({ runId: run.id, agentId: agent.id, note }).then(
        (answer) => onDone(answer.ok ? `Sent to ${agent.title}` : (answer.error ?? "Not sent")),
        (error: unknown) => onDone(error instanceof Error ? error.message : String(error)),
      );
    },
    [send, run.id, note, onDone],
  );
  if (agents === null) return <Text style={styles.flowMeta}>Loading agents...</Text>;
  if (agents.length === 0) return <Text style={styles.flowMeta}>No agents in this workspace</Text>;
  return (
    <View style={styles.flowSend}>
      <TextInput
        accessibilityLabel="Note for the agent"
        value={note}
        onChangeText={setNote}
        placeholder="Note for the agent"
        placeholderTextColor={styles.placeholderColor}
        maxLength={2000}
        style={styles.input}
      />
      <View style={styles.actions}>
        {agents.map((agent) => (
          <AgentButton key={agent.id} agent={agent} onSend={sendTo} styles={styles} />
        ))}
      </View>
    </View>
  );
}

interface AgentButtonProps {
  agent: { id: string; title: string };
  onSend(agent: { id: string; title: string }): void;
  styles: AndroidStyles;
}

function AgentButton({ agent, onSend, styles }: AgentButtonProps) {
  const press = useCallback(() => onSend(agent), [onSend, agent]);
  return <Button label={`Send to ${agent.title}`} onPress={press} styles={styles} />;
}

interface MaestroFlowsProps {
  workspaceId: string;
  styles: AndroidStyles;
}

export function MaestroFlows({ workspaceId, styles }: MaestroFlowsProps) {
  const listFlows = useRpc(maestroFlowsRpc);
  const start = useRpc(maestroStartRpc);
  const stop = useRpc(maestroStopRpc);
  const [flows, setFlows] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<MaestroRunState | null>(null);
  const [outputShown, setOutputShown] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    listFlows({ workspaceId }).then(
      (answer) => active && (setFlows(answer.flows), setProblem(answer.error ?? null)),
      (error: unknown) =>
        active && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      active = false;
    };
  }, [listFlows, workspaceId]);

  const onEvent = useCallback((event: { run: MaestroRunState | null }) => setRun(event.run), []);
  useSubscription(maestroRunSubscription, EMPTY_INPUT, onEvent);

  const running = run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const runFlow = useCallback(
    (flow: string) => {
      setProblem(null);
      setNotice(null);
      setSending(false);
      setOutputShown(false);
      start({ workspaceId, flow }).then(
        (answer) => answer.ok || setProblem(answer.error ?? "The flow did not start"),
        (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
      );
    },
    [start, workspaceId],
  );
  const stopRun = useCallback(() => void stop({}).catch(() => undefined), [stop]);
  const toggleOutput = useCallback(() => setOutputShown((shown) => !shown), []);
  const openSend = useCallback(() => {
    setNotice(null);
    setSending(true);
  }, []);
  const sent = useCallback((message: string) => {
    setSending(false);
    setNotice(message);
  }, []);

  if (flows !== null && flows.length === 0 && problem === null) {
    return <Text style={styles.status}>No Maestro flows in this workspace</Text>;
  }
  return (
    <ScrollView style={styles.flows} contentContainerStyle={styles.flowsContent}>
      <Text style={styles.flowsTitle}>Flows</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.flowProblem}>
          {problem}
        </Text>
      )}
      {flows === null ? <Text style={styles.flowMeta}>Loading flows...</Text> : null}
      {(flows ?? []).map((flow) => (
        <FlowRow key={flow} flow={flow} running={running} onRun={runFlow} styles={styles} />
      ))}
      {run === null ? null : (
        <View style={styles.flowResult}>
          <Text style={styles.flowName} numberOfLines={1}>
            {run.flow}
          </Text>
          {running ? (
            <View style={styles.flowRow}>
              <Text style={styles.flowMeta}>Running · {duration(now - run.startedAt)}</Text>
              <Button label="Stop" onPress={stopRun} styles={styles} />
            </View>
          ) : (
            <>
              <Text style={run.status === "passed" ? styles.flowMeta : styles.flowProblem}>
                {runSummary(run)}
              </Text>
              {run.status === "failed" && run.message ? (
                <Text style={styles.flowMeta}>{run.message}</Text>
              ) : null}
              <View style={styles.actions}>
                <Button
                  label={outputShown ? "Hide output" : "Show output"}
                  onPress={toggleOutput}
                  styles={styles}
                />
                {sending ? null : (
                  <Button label="Send to agent" onPress={openSend} styles={styles} />
                )}
              </View>
              {sending ? (
                <SendRow run={run} workspaceId={workspaceId} styles={styles} onDone={sent} />
              ) : null}
              {notice === null ? null : <Text style={styles.flowMeta}>{notice}</Text>}
            </>
          )}
          {outputShown && !running ? (
            <Text style={styles.flowOutput} selectable>
              {run.output.join("\n")}
            </Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
