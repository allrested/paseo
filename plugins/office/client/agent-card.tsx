import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/ui";
import type { AgentStatus, OfficeAgent } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { reasonLabel } from "./attention-strip.js";
import { agentMeta, agentTitle, answerableInOffice, attentionReason } from "./model.js";
import { PermissionActions } from "./permission-actions.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

type Navigation = PluginScreenProps["navigation"];

export const STATUS_LABELS: Record<AgentStatus, string> = {
  initializing: "Starting",
  idle: "Idle",
  running: "Running",
  error: "Error",
  closed: "Closed",
};

/** The agent's state in words, the same in a row and in the card: what it needs comes first. */
export function stateLabel(agent: OfficeAgent): string {
  const reason = attentionReason(agent);
  return reason === null ? STATUS_LABELS[agent.status] : reasonLabel(reason);
}

/** The box after a send: cleared only if it still holds what was sent, so later typing stays. */
export function textAfterSend(current: string, sent: string): string {
  return current.trim() === sent ? "" : current;
}

/** The agent's runs seen by the card: each start of a run is a new turn. */
export interface TurnCount {
  turns: number;
  running: boolean;
}

/** A Stop that failed, with the turn it was meant to stop. */
export interface StopFailure {
  turn: number;
  text: string;
}

/** The count after a render; the same object while the agent neither starts nor ends a run. */
export function countTurns(previous: TurnCount | null, running: boolean): TurnCount {
  if (previous === null) return { turns: running ? 1 : 0, running };
  if (previous.running === running) return previous;
  return { turns: previous.turns + (running ? 1 : 0), running };
}

/**
 * The Stop failure to show: only under the turn it was for, while that turn runs. A rejection
 * that comes back after its turn ended is never shown under the next one.
 */
export function shownStopError(failure: StopFailure | null, turn: TurnCount): string | null {
  if (failure === null || !turn.running || failure.turn !== turn.turns) return null;
  return failure.text;
}

interface AgentCardBodyProps {
  agent: OfficeAgent;
  activity: string | null;
  actions: AgentActions;
  navigation: Navigation;
  styles: OfficeStyles;
  onClose(): void;
}

function AgentCardBody({
  agent,
  activity,
  actions,
  navigation,
  styles,
  onClose,
}: AgentCardBodyProps) {
  const [text, setText] = useState("");
  const openSession = useCallback(() => {
    navigation?.openAgent({ agentId: agent.id });
    onClose();
  }, [navigation, agent.id, onClose]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Stop shares its row with Open session, so its error goes under the row, at the row's width.
  const [stopFailure, setStopFailure] = useState<StopFailure | null>(null);
  const running = agent.status === "running";
  // Counted during render (React's "state from the previous render"), so a failure of the last
  // turn never shows for a frame under the next one. Once the turn ended, so has its failure.
  const [counted, setCounted] = useState<TurnCount>(() => countTurns(null, running));
  const turn = countTurns(counted, running);
  if (turn !== counted) setCounted(turn);
  const stopError = shownStopError(stopFailure, turn);
  const stoppedTurn = turn.turns;
  const stop = useCallback(async () => {
    setStopFailure(null);
    try {
      await actions.cancel(agent.id);
    } catch (caught) {
      if (mounted.current) setStopFailure({ turn: stoppedTurn, text: failureText("Stop", caught) });
    }
  }, [actions, agent.id, stoppedTurn]);
  const send = useCallback(async () => {
    const sent = text.trim();
    await actions.send(agent.id, sent);
    if (mounted.current) setText((current) => textAfterSend(current, sent));
  }, [actions, agent.id, text]);
  // One accent button per sheet (docs/design.md section 3): while Approve is on it, Send is plain.
  const approving = agent.permissions.some((permission) => answerableInOffice(permission.kind));
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetStatus}>
        <Text style={styles.muted}>
          {agentMeta(agent)} · {stateLabel(agent)}
        </Text>
        {activity ? <Text style={styles.sheetText}>{activity}</Text> : null}
      </View>
      {agent.permissions.map((permission) => (
        <PermissionActions
          key={permission.id}
          agentId={agent.id}
          permission={permission}
          actions={actions}
          styles={styles}
        />
      ))}
      {navigation || running ? (
        <View style={styles.sheetActions}>
          <View style={styles.actions}>
            {navigation ? (
              <ActionButton
                label="Open session"
                pendingLabel="Opening..."
                onPress={openSession}
                styles={styles}
              />
            ) : null}
            {running ? (
              <ActionButton
                label="Stop"
                pendingLabel="Stopping..."
                onPress={stop}
                styles={styles}
              />
            ) : null}
          </View>
          {stopError ? (
            <Text accessibilityRole="alert" style={styles.actionError}>
              {stopError}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.sheetField}>
        <Text style={styles.sheetLabel}>Send a prompt</Text>
        <TextInput
          accessibilityLabel="Send a prompt"
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={styles.placeholderColor}
          multiline
          style={styles.input}
        />
      </View>
      <ActionButton
        label="Send"
        pendingLabel="Sending..."
        onPress={send}
        disabled={text.trim().length === 0}
        styles={styles}
        primary={!approving}
      />
    </View>
  );
}

export interface AgentCardProps {
  agent: OfficeAgent | null;
  activity: string | null;
  actions: AgentActions;
  navigation: Navigation;
  styles: OfficeStyles;
  onClose(): void;
}

/** Open session, send a prompt, answer a permission, stop the running turn. */
export function AgentCard({
  agent,
  activity,
  actions,
  navigation,
  styles,
  onClose,
}: AgentCardProps) {
  const change = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <Modal title={agent ? agentTitle(agent) : "Agent"} open={agent !== null} onOpenChange={change}>
      <Modal.Content>
        {agent ? (
          <AgentCardBody
            key={agent.id}
            agent={agent}
            activity={activity}
            actions={actions}
            navigation={navigation}
            styles={styles}
            onClose={onClose}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
