import { useCallback, useMemo, useReducer, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Button } from "@/components/ui/button";
import { foregroundIconColorMapping } from "@/components/ui/icon-color";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { useRelativeTimeTick } from "@/usage/use-relative-time-tick";
import {
  closeMoveDialog,
  openMoveDialog,
  selectMoveDialogRequest,
  useMoveDialogStore,
  type MoveDialogRequest,
  type MoveDialogScope,
} from "./move-dialog-store";
import {
  INITIAL_MOVE_FORM,
  moveFormReducer,
  resolveMoveModelId,
  resolveMoveSubmission,
} from "./move-model";
import {
  describeMoveTarget,
  findTargetByProvider,
  groupTargetsByFamily,
  isSelectableTarget,
  type AgentMoveTargetsView,
  type MoveTargetDescription,
} from "./move-targets";
import { isSessionAgentArchived } from "./resolve-moved-agent";
import { useAgentMove, useSupportsAgentMove } from "./use-agent-move";

const ThemedCheck = withUnistyles(Check);

/** The tab menu's "Move session…" action for a host, or nothing when the host cannot move agents. */
export function useMoveAgentMenuAction(
  serverId: string,
  workspaceId: string,
): ((agentId: string) => void) | undefined {
  const supported = useSupportsAgentMove(serverId);
  return useMemo(() => {
    if (!supported) return undefined;
    return (agentId: string) => openMoveDialog({ serverId, workspaceId, agentId });
  }, [serverId, supported, workspaceId]);
}

/**
 * The menu action for one tab: nothing for an archived agent, whose move the host always refuses.
 * An agent the session does not hold yet keeps the action, and the host refusal stays the backstop.
 */
export function useTabMoveAgentAction(
  serverId: string,
  tab: WorkspaceTabDescriptor,
  onMoveAgent: ((agentId: string) => void) | undefined,
): ((agentId: string) => void) | undefined {
  const agentId = tab.target.kind === "agent" ? tab.target.agentId : null;
  const isArchived = useSessionStore(
    (state) => agentId !== null && isSessionAgentArchived(state.sessions[serverId], agentId),
  );
  return isArchived ? undefined : onMoveAgent;
}

interface MoveDialogHostProps extends MoveDialogScope {
  enabled: boolean;
}

/**
 * Mounted once per workspace screen; renders the dialog while one of its agents is being moved.
 * Only the focused screen's host is enabled, so a retained screen behind it never shows a second
 * copy, and a request stays with the workspace that opened it.
 */
export function MoveDialogHost({ serverId, workspaceId, enabled }: MoveDialogHostProps) {
  const request = useMoveDialogStore((state) =>
    selectMoveDialogRequest(state, { serverId, workspaceId }),
  );
  if (!enabled || !request) return null;
  return (
    <MoveDialog
      key={`${request.serverId}:${request.agentId}`}
      serverId={request.serverId}
      agentId={request.agentId}
    />
  );
}

type MoveDialogProps = Pick<MoveDialogRequest, "serverId" | "agentId">;

function MoveDialog({ serverId, agentId }: MoveDialogProps) {
  const { t } = useTranslation();
  const { targets, move, status } = useAgentMove({
    serverId,
    agentId,
    targetsEnabled: true,
    recheckProvider: null,
    onMoved: closeMoveDialog,
  });
  const [form, dispatch] = useReducer(moveFormReducer, INITIAL_MOVE_FORM);
  const isMoving = status.kind === "loading";
  const selectedTarget = findTargetByProvider(targets, form.provider);

  const agentCwd = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? null,
  );
  const snapshot = useProvidersSnapshot(serverId, {
    cwd: agentCwd,
    enabled: selectedTarget !== null,
  });
  const targetProvider = useMemo(() => {
    if (!selectedTarget) return null;
    const providers = buildSelectableProviderSelectorProviders(snapshot.entries);
    return providers.find((provider) => provider.id === selectedTarget.provider) ?? null;
  }, [selectedTarget, snapshot.entries]);
  const modelId = resolveMoveModelId(targetProvider, form.chosenModelId);
  const submission = useMemo(
    () => resolveMoveSubmission({ form, targets, provider: targetProvider }),
    [form, targetProvider, targets],
  );

  const selectTarget = useCallback(
    (provider: string) => dispatch({ type: "select-target", provider }),
    [],
  );
  const selectModel = useCallback(
    (_provider: string, model: string) => dispatch({ type: "select-model", modelId: model }),
    [],
  );
  const setContinueWork = useCallback(
    (continueWork: boolean) => dispatch({ type: "set-continue", continueWork }),
    [],
  );

  const handleClose = useCallback(() => {
    if (isMoving) return;
    closeMoveDialog();
  }, [isMoving]);

  const handleMove = useCallback(() => {
    if (submission) move(submission);
  }, [move, submission]);

  const header = useMemo<SheetHeader>(() => ({ title: t("sessionMove.dialog.title") }), [t]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={handleClose}
          disabled={isMoving}
          testID="move-session-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleMove}
          disabled={!submission}
          loading={isMoving}
          testID="move-session-submit"
        >
          {isMoving ? t("sessionMove.dialog.moving") : t("sessionMove.dialog.move")}
        </Button>
      </View>
    ),
    [handleClose, handleMove, isMoving, submission, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={handleClose}
      footer={footer}
      testID="move-session-dialog"
    >
      <MoveTargetList
        targets={targets}
        selectedProvider={form.provider}
        disabled={isMoving}
        onSelect={selectTarget}
      />

      <SettingsCard>
        <MoveModelRow
          serverId={serverId}
          provider={targetProvider}
          modelId={modelId}
          snapshot={snapshot}
          disabled={isMoving}
          onSelect={selectModel}
        />
        <SettingsRow label={t("sessionMove.dialog.continueAutomatically")}>
          <Switch
            value={form.continueWork}
            onValueChange={setContinueWork}
            disabled={isMoving}
            accessibilityLabel={t("sessionMove.dialog.continueAutomatically")}
            testID="move-session-continue"
          />
        </SettingsRow>
      </SettingsCard>

      {status.kind === "error" ? (
        <Text accessibilityRole="alert" style={settingsStyles.rowError} testID="move-session-error">
          {status.message}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

/** One row standing in for the list while it has no targets to show. */
function MoveTargetListState({ children }: { children: ReactNode }) {
  return (
    <SettingsCard>
      <View style={settingsStyles.row}>{children}</View>
    </SettingsCard>
  );
}

function MoveTargetList({
  targets,
  selectedProvider,
  disabled,
  onSelect,
}: {
  targets: AgentMoveTargetsView;
  selectedProvider: string | null;
  disabled: boolean;
  onSelect: (provider: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const families = useMemo(
    () => (targets.kind === "ready" ? groupTargetsByFamily(targets.targets) : []),
    [targets],
  );
  const anyTargetResets =
    targets.kind === "ready" && targets.targets.some((target) => target.resetsAt !== null);
  // One clock for the whole list, so the reset countdowns on its badges keep moving.
  const now = useRelativeTimeTick({ enabled: anyTargetResets });
  const locale = i18n.resolvedLanguage;

  if (targets.kind === "loading") {
    return (
      <MoveTargetListState>
        <Text style={settingsStyles.rowHint}>{t("sessionMove.dialog.loading")}</Text>
      </MoveTargetListState>
    );
  }
  if (targets.kind === "disconnected") {
    return (
      <MoveTargetListState>
        <Text style={settingsStyles.rowHint}>{t("sessionMove.hostDisconnected")}</Text>
      </MoveTargetListState>
    );
  }
  if (targets.kind === "error") {
    return (
      <MoveTargetListState>
        <Text accessibilityRole="alert" style={settingsStyles.rowError}>
          {targets.message}
        </Text>
      </MoveTargetListState>
    );
  }
  if (families.length === 0) {
    return (
      <MoveTargetListState>
        <Text style={settingsStyles.rowHint}>{t("sessionMove.dialog.empty")}</Text>
      </MoveTargetListState>
    );
  }
  return families.map((group) => (
    <SettingsSection key={group.family} title={group.label} flush>
      <SettingsCard>
        {group.targets.map((target) => (
          <MoveTargetRow
            key={target.provider}
            target={target}
            description={describeMoveTarget(target, { now, locale, t })}
            selected={target.provider === selectedProvider}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  ));
}

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** The target's models, from the same provider snapshot the new-agent composer lists. */
function MoveModelRow({
  serverId,
  provider,
  modelId,
  snapshot,
  disabled,
  onSelect,
}: {
  serverId: string;
  /** Null until a target is chosen, or when the host does not know its models. */
  provider: ProviderSelectorProvider | null;
  modelId: string | undefined;
  snapshot: ReturnType<typeof useProvidersSnapshot>;
  disabled: boolean;
  onSelect: (provider: string, modelId: string) => void;
}) {
  const { t } = useTranslation();
  const providers = useMemo(() => (provider ? [provider] : []), [provider]);
  const providerId = provider?.id ?? "";
  const { refetchIfStale, refresh } = snapshot;
  const handleOpen = useCallback(() => refetchIfStale(providerId), [providerId, refetchIfStale]);
  const handleRetry = useCallback((id: string) => void refresh([id]), [refresh]);
  return (
    <SettingsRow label={t("sessionMove.dialog.model")}>
      <CombinedModelSelector
        providers={providers}
        selectedProvider={providerId}
        selectedModel={modelId ?? ""}
        onSelect={onSelect}
        isLoading={snapshot.isLoading || snapshot.isFetching}
        onOpen={handleOpen}
        onRetryProvider={handleRetry}
        isRetryingProvider={snapshot.isRefreshing}
        disabled={disabled || !provider}
        serverId={serverId}
        desktopPlacement="bottom-start"
        desktopMinWidth={320}
      />
    </SettingsRow>
  );
}

function MoveTargetRow({
  target,
  description,
  selected,
  disabled,
  onSelect,
}: {
  target: AgentMoveTarget;
  description: MoveTargetDescription;
  selected: boolean;
  disabled: boolean;
  onSelect: (provider: string) => void;
}) {
  const selectable = isSelectableTarget(target);
  const isDisabled = disabled || !selectable;
  const rowStyle = useCallback(
    ({ hovered, pressed }: HoverState) => [
      !isDisabled && hovered && styles.hovered,
      !isDisabled && pressed && styles.pressed,
      !selectable && styles.unselectable,
    ],
    [isDisabled, selectable],
  );
  const handlePress = useCallback(() => onSelect(target.provider), [onSelect, target.provider]);
  const accessibilityState = useMemo(
    () => ({ checked: selected, disabled: isDisabled }),
    [isDisabled, selected],
  );
  const { badge } = description;
  return (
    <PressHighlight
      accessibilityRole="radio"
      accessibilityLabel={description.accessibilityLabel}
      accessibilityState={accessibilityState}
      aria-checked={selected}
      disabled={isDisabled}
      onPress={handlePress}
      style={rowStyle}
      highlightStyle={styles.pressed}
      testID={`move-session-target-${target.provider}`}
    >
      <SettingsRow label={target.label}>
        <View style={styles.trailing}>
          {badge ? <StatusBadge label={badge.label} variant={badge.variant} /> : null}
          {/* The check keeps its slot when unselected, so the badge does not shift on selection. */}
          <View style={styles.checkSlot}>
            {selected ? (
              <ThemedCheck size={ICON_SIZE.sm} uniProps={foregroundIconColorMapping} />
            ) : null}
          </View>
        </View>
      </SettingsRow>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  checkSlot: {
    width: ICON_SIZE.sm,
    alignItems: "center",
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface3,
  },
  unselectable: {
    opacity: theme.opacity[50],
  },
}));
