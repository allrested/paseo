import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { formatResetLabel, formatResetTime } from "@/usage/format";
import { useRelativeTimeTick } from "@/usage/use-relative-time-tick";
import { storeFetchedAgentDetail } from "@/utils/fetched-agent-detail";
import {
  selectMoveBannerFacts,
  selectMovedFromAgentToFetch,
  type MoveBannerFacts,
} from "./move-banner-facts";
import {
  resolveMoveBannerKind,
  resolveMoveBannerView,
  upcomingLimitReset,
  type MoveBannerKind,
} from "./move-banner-view";
import { openMoveDialog } from "./move-dialog-store";
import { useAgentMove, useSupportsAgentMove } from "./use-agent-move";
import {
  describeUsageHeadsUp,
  isUsageHeadsUpDismissed,
  resolveUsageHeadsUp,
  type UsageHeadsUp,
} from "./usage-heads-up";
import {
  dismissUsageHeadsUp,
  selectUsageHeadsUpDismissal,
  useUsageHeadsUpStore,
} from "./usage-heads-up-store";

/**
 * Loads the agent this one was moved from into the session when it is missing, as after an app
 * restart, so the banner can name its account and check its usage.
 */
function useLoadMovedFromAgent(serverId: string, movedFromAgentId: string | null): void {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  useFetchQuery({
    queryKey: ["moved-from-agent", serverId, movedFromAgentId] as const,
    queryFn: async () => {
      if (!client || !movedFromAgentId) return false;
      const result = await client.fetchAgent({ agentId: movedFromAgentId });
      if (result) storeFetchedAgentDetail({ serverId, result });
      return result !== null;
    },
    enabled: Boolean(client && isConnected && movedFromAgentId),
    dataShape: "value",
    // Fetched again each time the original drops out of the session: a move back makes it live,
    // and archiving it again evicts it from the session.
    staleTimeMs: 0,
    retry: false,
  });
}

interface MoveBannerProps {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

/**
 * The notice above an agent's composer about moving it: its account hit a limit, is about to run
 * out, or it was moved here from another account it can go back to. Nothing on hosts that cannot
 * move agents.
 */
export function MoveBanner(props: MoveBannerProps) {
  const supported = useSupportsAgentMove(props.serverId);
  if (!supported) return null;
  return <SupportedMoveBanner {...props} />;
}

function SupportedMoveBanner({ serverId, workspaceId, agentId }: MoveBannerProps) {
  const facts = useSessionStore(
    useShallow((state) => selectMoveBannerFacts(state.sessions[serverId], agentId)),
  );
  useLoadMovedFromAgent(serverId, selectMovedFromAgentToFetch(facts));
  // A host that reports run-outs keeps the banner mounted for every live agent, so it can read
  // the agent's own account.
  const headsUpSupported = useHostFeature(serverId, "usageHeadsUp");
  const kind = resolveMoveBannerKind(facts);
  if (facts.kind === "inactive") return null;
  if (kind === "none" && !headsUpSupported) return null;
  // Keyed by agent and kind, so a tab that follows a moved agent, or a Move back notice that turns
  // into a limit, mounts a new targets observer. It reads the targets again instead of showing the
  // last agent's accounts or naming a reset from the last Move back fetch.
  return (
    <MoveBannerNotice
      key={`${agentId}:${kind}`}
      serverId={serverId}
      workspaceId={workspaceId}
      agentId={agentId}
      facts={facts}
      kind={kind}
      headsUpSupported={headsUpSupported}
    />
  );
}

interface MoveBannerNoticeProps extends MoveBannerProps {
  facts: MoveBannerFacts;
  kind: MoveBannerKind;
  headsUpSupported: boolean;
}

function MoveBannerNotice({
  serverId,
  workspaceId,
  agentId,
  facts,
  kind,
  headsUpSupported,
}: MoveBannerNoticeProps) {
  const isPanelActive = useRetainedPanelActive();
  const isAppVisible = useAppVisible();
  // A hidden tab or app fetches nothing, and showing it again refetches a list older than the
  // query's stale time (native has no focus manager). Only a Move back on screen polls the
  // original's account; with the heads-up, a visible panel polls the agent's own account.
  const isMoveBackOnScreen = kind === "moved-from" && isPanelActive;
  const isHeadsUpOnScreen = headsUpSupported && isPanelActive && isAppVisible;
  const movedFromProvider = facts.kind === "live" ? facts.movedFromProvider : null;
  const { canMove, targets, move, moveBack, status } = useAgentMove({
    serverId,
    agentId,
    targetsEnabled: isPanelActive && isAppVisible,
    recheckProvider: isMoveBackOnScreen ? movedFromProvider : null,
    pollTargets: isHeadsUpOnScreen,
  });
  const now = useRelativeTimeTick({ enabled: isHeadsUpOnScreen });
  const headsUp = useMemo(
    () => (headsUpSupported ? resolveUsageHeadsUp(targets, now) : null),
    [headsUpSupported, now, targets],
  );
  const dismissal = useUsageHeadsUpStore((state) =>
    selectUsageHeadsUpDismissal(state, { serverId, windowKey: headsUp?.windowKey ?? null }),
  );
  const visibleHeadsUp =
    headsUp && !isUsageHeadsUpDismissed({ headsUp, dismissal, now }) ? headsUp : null;
  const openDialog = useCallback(
    () => openMoveDialog({ serverId, workspaceId, agentId }),
    [agentId, serverId, workspaceId],
  );
  const moveBackAndContinue = useCallback(() => moveBack({ continueWork: true }), [moveBack]);
  const bestTarget = visibleHeadsUp?.best ?? null;
  // The dialog's path: the target's default model, and the agent continues on its own.
  const moveToBest = useCallback(() => {
    if (bestTarget) move({ target: bestTarget, model: undefined, continueWork: true });
  }, [bestTarget, move]);
  const dismissHeadsUp = useCallback(() => {
    if (!visibleHeadsUp) return;
    dismissUsageHeadsUp({
      serverId,
      windowKey: visibleHeadsUp.windowKey,
      dismissal: {
        level: visibleHeadsUp.level,
        tone: visibleHeadsUp.tone,
        resetsAt: visibleHeadsUp.resetsAt,
      },
    });
  }, [serverId, visibleHeadsUp]);
  const view = resolveMoveBannerView({ facts, targets, headsUp: visibleHeadsUp });

  if (view.kind === "limit") {
    return (
      <LimitReachedNotice account={view.account} resetsAt={view.resetsAt} onMove={openDialog} />
    );
  }
  if (view.kind === "heads-up") {
    return (
      <UsageHeadsUpNotice
        headsUp={view.headsUp}
        now={now}
        canMove={canMove}
        isMoving={status.kind === "loading"}
        error={status.kind === "error" ? status.message : null}
        onMove={moveToBest}
        onMore={openDialog}
        onDismiss={dismissHeadsUp}
      />
    );
  }
  if (view.kind === "moved-from") {
    return (
      <MovedFromNotice
        label={view.label}
        highlighted={view.highlighted}
        canMoveBack={canMove}
        isMovingBack={status.kind === "loading"}
        error={status.kind === "error" ? status.message : null}
        onMoveBack={moveBackAndContinue}
      />
    );
  }
  return null;
}

function LimitReachedNotice({
  account,
  resetsAt,
  onMove,
}: {
  account: string;
  resetsAt: string | null;
  onMove: () => void;
}) {
  const { t } = useTranslation();
  const now = useRelativeTimeTick({ enabled: resetsAt !== null });
  const reset = formatResetLabel(upcomingLimitReset(resetsAt, now), false, now);
  const message = reset
    ? t("sessionMove.banner.limitReachedResets", { account, reset })
    : t("sessionMove.banner.limitReached", { account });
  return (
    <NoticeRail>
      <Alert size="sm" variant="warning" description={message} testID="move-banner-limit">
        <Button variant="outline" onPress={onMove} testID="move-banner-move">
          {t("sessionMove.banner.moveTo")}
        </Button>
      </Alert>
    </NoticeRail>
  );
}

interface UsageHeadsUpNoticeProps {
  headsUp: UsageHeadsUp;
  now: number;
  canMove: boolean;
  isMoving: boolean;
  error: string | null;
  onMove: () => void;
  onMore: () => void;
  onDismiss: () => void;
}

/** The agent's account is about to run out. */
function UsageHeadsUpNotice({
  headsUp,
  now,
  canMove,
  isMoving,
  error,
  onMove,
  onMore,
  onDismiss,
}: UsageHeadsUpNoticeProps) {
  const { t } = useTranslation();
  const formatClock = useCallback((iso: string | null) => formatResetTime(iso, now, t), [now, t]);
  const { message, moveLabel } = describeUsageHeadsUp(headsUp, { t, formatClock });
  const isDanger = headsUp.tone === "danger";
  return (
    <NoticeRail>
      <Alert
        size="sm"
        variant={error || isDanger ? "error" : "warning"}
        title={error ? message : undefined}
        description={error ?? message}
        testID="move-banner-heads-up"
      >
        {moveLabel ? (
          <Button
            variant="outline"
            onPress={onMove}
            disabled={!canMove}
            loading={isMoving}
            testID="move-banner-heads-up-move"
          >
            {isMoving ? t("sessionMove.headsUp.moving") : moveLabel}
          </Button>
        ) : null}
        <Button variant="outline" onPress={onMore} testID="move-banner-heads-up-more">
          {t("sessionMove.headsUp.more")}
        </Button>
        <Button variant="ghost" onPress={onDismiss} testID="move-banner-heads-up-dismiss">
          {t("sessionMove.headsUp.dismiss")}
        </Button>
      </Alert>
    </NoticeRail>
  );
}

function MovedFromNotice({
  label,
  highlighted,
  canMoveBack,
  isMovingBack,
  error,
  onMoveBack,
}: {
  label: string | null;
  highlighted: boolean;
  canMoveBack: boolean;
  isMovingBack: boolean;
  error: string | null;
  onMoveBack: () => void;
}) {
  const { t } = useTranslation();
  const message = label
    ? t("sessionMove.banner.movedFrom", { label })
    : t("sessionMove.banner.movedFromUnknown");
  return (
    <NoticeRail>
      <Alert
        size="sm"
        variant={error ? "error" : "default"}
        title={error ? message : undefined}
        description={error ?? message}
        testID="move-banner-moved-from"
      >
        {/* The highlight is accent text on the standard outline action. The composer's send button
            owns the surface's accent fill (docs/design.md §3). */}
        <Button
          variant="outline"
          textStyle={highlighted ? styles.highlightedText : undefined}
          onPress={onMoveBack}
          disabled={!canMoveBack}
          loading={isMovingBack}
          testID="move-banner-move-back"
        >
          {isMovingBack ? t("sessionMove.banner.movingBack") : t("sessionMove.banner.moveBack")}
        </Button>
      </Alert>
    </NoticeRail>
  );
}

function NoticeRail({ children }: { children: ReactNode }) {
  return (
    <View style={styles.rail}>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
  },
  content: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
  },
  highlightedText: {
    color: theme.colors.accent,
  },
}));
