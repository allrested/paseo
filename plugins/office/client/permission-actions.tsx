import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { OfficePermission } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { answerableInOffice } from "./model.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

export interface PermissionActionsProps {
  agentId: string;
  permission: OfficePermission;
  actions: AgentActions;
  styles: OfficeStyles;
  /**
   * Opens the agent's session. A row passes it, so a plan or a question has a button beside it.
   * The card does not: its own "Open session" is the next thing down.
   */
  onOpenSession?(): void;
}

interface SessionAnswerProps {
  styles: OfficeStyles;
  onOpenSession: (() => void) | undefined;
}

/** A plan or a question is answered in the session: the way there, or the words for it. */
function SessionAnswer({ styles, onOpenSession }: SessionAnswerProps) {
  if (!onOpenSession) return <Text style={styles.muted}>Answer in the session</Text>;
  return (
    <View style={styles.actions}>
      <ActionButton
        label="Open session"
        pendingLabel="Opening..."
        onPress={onOpenSession}
        styles={styles}
      />
    </View>
  );
}

/** One request and its answer. The caller places it: a row's text rail, or the card. */
export function PermissionActions({
  agentId,
  permission,
  actions,
  styles,
  onOpenSession,
}: PermissionActionsProps) {
  // One answer per request: while Approve or Deny is in flight, a tap on the other does nothing,
  // and the other is dimmed to say so.
  const answering = useRef(false);
  const [inFlight, setInFlight] = useState<"approve" | "deny" | null>(null);
  // The error belongs to the pair, so it has the request's width. Under its own button it would
  // be as narrow as "Deny", or stretch that button and push the other one away.
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const answer = useCallback(
    async (allow: boolean) => {
      if (answering.current) return;
      answering.current = true;
      setInFlight(allow ? "approve" : "deny");
      setError(null);
      let failure: string | null = null;
      try {
        await actions.respond(agentId, permission.id, allow);
      } catch (caught) {
        failure = failureText(allow ? "Approve" : "Deny", caught);
      }
      answering.current = false;
      // An answer that lands takes the request, and this view with it, out of the model.
      if (!mounted.current) return;
      setInFlight(null);
      setError(failure);
    },
    [actions, agentId, permission.id],
  );
  const approve = useCallback(() => answer(true), [answer]);
  const deny = useCallback(() => answer(false), [answer]);
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle} numberOfLines={2}>
        {permission.title}
      </Text>
      {answerableInOffice(permission.kind) ? (
        <View style={styles.actions}>
          <ActionButton
            label="Approve"
            pendingLabel="Approving..."
            onPress={approve}
            disabled={inFlight === "deny"}
            styles={styles}
            primary
          />
          <ActionButton
            label="Deny"
            pendingLabel="Denying..."
            onPress={deny}
            disabled={inFlight === "approve"}
            styles={styles}
          />
        </View>
      ) : (
        <SessionAnswer styles={styles} onOpenSession={onOpenSession} />
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
