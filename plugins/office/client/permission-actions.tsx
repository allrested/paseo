import { useCallback, useRef } from "react";
import { Text, View } from "react-native";
import type { OfficePermission } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { answerableInOffice } from "./model.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

export interface PermissionActionsProps {
  agentId: string;
  permission: OfficePermission;
  actions: AgentActions;
  styles: OfficeStyles;
}

/** One request and its answer. The caller places it: a row's text rail, or the card. */
export function PermissionActions({
  agentId,
  permission,
  actions,
  styles,
}: PermissionActionsProps) {
  // One answer per request: while Approve or Deny is in flight, a tap on the other does nothing.
  const answering = useRef(false);
  const answer = useCallback(
    async (allow: boolean) => {
      if (answering.current) return;
      answering.current = true;
      try {
        await actions.respond(agentId, permission.id, allow);
      } finally {
        answering.current = false;
      }
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
            styles={styles}
            primary
          />
          <ActionButton label="Deny" pendingLabel="Denying..." onPress={deny} styles={styles} />
        </View>
      ) : (
        <Text style={styles.muted}>Answer in the session</Text>
      )}
    </View>
  );
}
