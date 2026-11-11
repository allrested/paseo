import { useCallback } from "react";
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
  const approve = useCallback(
    () => actions.respond(agentId, permission.id, true),
    [actions, agentId, permission.id],
  );
  const deny = useCallback(
    () => actions.respond(agentId, permission.id, false),
    [actions, agentId, permission.id],
  );
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
