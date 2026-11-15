import { ArrowRight, MoreHorizontal, X } from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import { UsageMeter } from "@/usage/meter";
import { UsageResetLine } from "@/usage/reset-line";
import {
  resolveHandoffLayout,
  type HandoffAccountCopy,
  type HandoffCopy,
  type HandoffLayout,
  type HandoffStatusCopy,
} from "./handoff-view";

// Until the card is measured, the window's form factor stands in for its width.
const STACKED: HandoffLayout = { kind: "stacked", namedActions: false };
const WIDE: HandoffLayout = { kind: "wide", namedActions: true };

const ThemedArrowRight = withUnistyles(ArrowRight, mutedIconColorMapping);
const ThemedMore = withUnistyles(MoreHorizontal, mutedIconColorMapping);
const ThemedX = withUnistyles(X, mutedIconColorMapping);
const ThemedSpinner = withUnistyles(LoadingSpinner, mutedIconColorMapping);

export interface HandoffCardProps {
  copy: HandoffCopy;
  canMove: boolean;
  isMoving: boolean;
  /** A move that failed, said under the accounts. */
  error: string | null;
  /** The next account is still being read. */
  isChecking: boolean;
  onMove: () => void;
  /** Opens the list of every account the chat can move to. */
  onMore: () => void;
  /** Set on a heads-up, which can be put away; a limit stays until the chat moves or it resets. */
  onDismiss?: () => void;
  testID: string;
}

/**
 * The agent's own account next to the account its chat can continue on, each as a usage bar, and
 * the one action that moves the chat there. It stands above the composer when the account hit
 * its limit or is about to.
 */
export function HandoffCard({
  copy,
  canMove,
  isMoving,
  error,
  isChecking,
  onMove,
  onMore,
  onDismiss,
  testID,
}: HandoffCardProps) {
  const isCompact = useIsCompactFormFactor();
  const [layout, setLayout] = useState<HandoffLayout>(isCompact ? STACKED : WIDE);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = resolveHandoffLayout(event.nativeEvent.layout.width);
    setLayout((previous) =>
      previous.kind === next.kind && previous.namedActions === next.namedActions ? previous : next,
    );
  }, []);
  const stacked = layout.kind === "stacked";
  const status = <StatusLine status={copy.status} />;
  const actions = (
    <HandoffActions
      moveLabel={copy.moveLabel}
      canMove={canMove}
      isMoving={isMoving}
      stacked={stacked}
      named={layout.namedActions}
      compact={isCompact}
      onMove={onMove}
      onMore={onMore}
      onDismiss={onDismiss}
      testID={testID}
    />
  );

  return (
    <View style={styles.card} onLayout={onLayout} accessibilityRole="alert" testID={testID}>
      <View style={stacked ? styles.accountsStacked : styles.accounts}>
        <AccountRow account={copy.current} shared={!stacked} testID={`${testID}-current`}>
          {stacked ? status : null}
        </AccountRow>
        {copy.next ? (
          <AccountRow account={copy.next} destination shared={!stacked} testID={`${testID}-next`} />
        ) : (
          <View style={stacked ? styles.note : styles.noteShared} testID={`${testID}-note`}>
            {isChecking ? <ThemedSpinner size={ICON_SIZE.sm} /> : null}
            <Text style={styles.noteText}>{copy.note}</Text>
          </View>
        )}
      </View>
      {stacked ? (
        actions
      ) : (
        <View style={styles.footer}>
          <View style={styles.footerStatus}>{status}</View>
          {actions}
        </View>
      )}
      {error ? (
        <Text style={styles.error} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function AccountRow({
  account,
  destination = false,
  shared,
  children,
  testID,
}: {
  account: HandoffAccountCopy;
  /** The accounts stand side by side and share the row's width. */
  shared: boolean;
  /** The account the chat moves to: its name follows an arrow. */
  destination?: boolean;
  children?: ReactNode;
  testID: string;
}) {
  return (
    <View style={shared ? styles.accountShared : styles.account} testID={testID}>
      <View style={styles.labelRow}>
        {destination ? <ThemedArrowRight size={ICON_SIZE.sm} /> : null}
        <Text style={styles.name} numberOfLines={1}>
          {account.name}
        </Text>
        {account.window ? (
          <Text style={styles.window} numberOfLines={1}>
            {account.window}
          </Text>
        ) : null}
        {account.value ? <Text style={styles.value}>{account.value}</Text> : null}
      </View>
      {account.value ? <UsageMeter percent={account.percent} tone={account.tone} /> : null}
      {children}
    </View>
  );
}

/** "Limit reached · resets in 1h 36m · 9:10 PM" under the agent's own account. */
function StatusLine({ status }: { status: HandoffStatusCopy }) {
  if (!status.alarm && !status.countdown) return null;
  return (
    <View style={styles.status}>
      {status.alarm ? <Text style={styles.alarm}>{status.alarm}</Text> : null}
      {status.alarm && status.countdown ? (
        <Text style={styles.statusSeparator}>{" · "}</Text>
      ) : null}
      <View style={styles.reset}>
        <UsageResetLine
          countdown={status.countdown}
          exactTime={status.exactTime}
          atRisk={status.atRisk}
        />
      </View>
    </View>
  );
}

function HandoffActions({
  moveLabel,
  canMove,
  isMoving,
  stacked,
  named,
  compact,
  onMove,
  onMore,
  onDismiss,
  testID,
}: {
  moveLabel: string | null;
  canMove: boolean;
  isMoving: boolean;
  /** The actions have a row of their own, which the move fills. */
  stacked: boolean;
  /** There is room for every action's name. */
  named: boolean;
  compact: boolean;
  onMove: () => void;
  onMore: () => void;
  onDismiss?: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const moreLabel = t("sessionMove.handoff.otherAccounts");
  const dismissLabel = t("sessionMove.headsUp.dismiss");
  // Without a move, "Other accounts" is the card's one action and keeps its name.
  const icons = !named && moveLabel !== null;
  const iconSize = paneContentToolbarIconSize(compact);
  const move = moveLabel ? (
    <Button
      variant="secondary"
      onPress={onMove}
      disabled={!canMove}
      loading={isMoving}
      style={stacked ? styles.moveStacked : undefined}
      testID={`${testID}-move`}
    >
      {isMoving ? t("sessionMove.headsUp.moving") : moveLabel}
    </Button>
  ) : null;
  const more = icons ? (
    <ToolbarButton
      label={moreLabel}
      round
      compact={compact}
      hitSlop={8}
      tooltipSide="top"
      onPress={onMore}
      testID={`${testID}-more`}
    >
      <ThemedMore size={iconSize} />
    </ToolbarButton>
  ) : (
    <Button variant={moveLabel ? "ghost" : "outline"} onPress={onMore} testID={`${testID}-more`}>
      {moreLabel}
    </Button>
  );
  const dismiss = onDismiss ? (
    <DismissAction
      label={dismissLabel}
      icon={icons}
      compact={compact}
      onPress={onDismiss}
      testID={`${testID}-dismiss`}
    />
  ) : null;
  // Stacked, the move leads and fills the row. Wide, it ends the row: its edge sits on the card's
  // trailing rail, under the bar of the account it moves to.
  return stacked ? (
    <View style={styles.actionsStacked}>
      {move}
      {more}
      {dismiss}
    </View>
  ) : (
    <View style={styles.actions}>
      {dismiss}
      {more}
      {move}
    </View>
  );
}

function DismissAction({
  label,
  icon,
  compact,
  onPress,
  testID,
}: {
  label: string;
  icon: boolean;
  compact: boolean;
  onPress: () => void;
  testID: string;
}) {
  if (!icon) {
    return (
      <Button variant="ghost" onPress={onPress} testID={testID}>
        {label}
      </Button>
    );
  }
  return (
    <ToolbarButton
      label={label}
      round
      compact={compact}
      hitSlop={8}
      tooltipSide="top"
      onPress={onPress}
      testID={testID}
    >
      <ThemedX size={paneContentToolbarIconSize(compact)} />
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The shape of the notices it shares the rail with (`Alert`, size sm).
  card: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius["2xl"],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  accounts: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[6],
  },
  // The status under the agent's own account, the actions under the account they move to.
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  footerStatus: {
    flex: 1,
    minWidth: 0,
  },
  accountsStacked: {
    gap: theme.spacing[3],
  },
  account: {
    gap: theme.spacing[1],
  },
  accountShared: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  window: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // Pushed to the row's end, over the end of the bar it measures.
  value: {
    flexShrink: 0,
    marginLeft: "auto",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
  },
  alarm: {
    flexShrink: 0,
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  statusSeparator: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  reset: {
    flexShrink: 1,
    minWidth: 0,
  },
  // As tall as an account's name and bar, so the card keeps its height when the account arrives.
  note: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  noteShared: {
    flex: 1,
    minWidth: 0,
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  noteText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  actionsStacked: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  moveStacked: {
    flex: 1,
    minWidth: 0,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
