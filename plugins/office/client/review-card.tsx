import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ExternalLink, Modal } from "@getpaseo/plugin/client/ui";
import { ActionButton, failureText } from "./action-button.js";
import {
  REVIEW_HELP,
  reviewAskLabel,
  reviewHint,
  reviewSummary,
  type ReviewAsked,
  type ReviewRow,
} from "./review-text.js";
import type { OfficeStyles } from "./styles.js";

interface AskedProps {
  asked: ReviewAsked;
  styles: OfficeStyles;
}

/** The request for a review and what came of it. */
function Asked({ asked, styles }: AskedProps) {
  if (asked.text === null) {
    return (
      <Text style={styles.rowMeta}>
        Asked {asked.title}. Its note shows here once it is on the board.
      </Text>
    );
  }
  return (
    <View style={styles.reviewAnswer}>
      <Text style={styles.rowMeta}>Review by {asked.title}</Text>
      <Text style={styles.sheetText}>{asked.text}</Text>
      {asked.cut ? <Text style={styles.rowMeta}>The board has the rest.</Text> : null}
    </View>
  );
}

interface RowProps {
  row: ReviewRow;
  wakesPaused: boolean;
  ask(row: ReviewRow): Promise<void>;
  /** Undefined on a host that cannot open a workspace from here. */
  onOpenWorkspace: ((roomId: string) => void) | undefined;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
}

function Row({ row, wakesPaused, ask, onOpenWorkspace, onOpenBoard, styles }: RowProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The buttons share a row, so a refusal goes under the row, at the row's width.
  const [failure, setFailure] = useState<string | null>(null);
  const label = reviewAskLabel(row);
  const request = useCallback(async () => {
    setFailure(null);
    try {
      await ask(row);
    } catch (caught) {
      if (mounted.current) setFailure(failureText(label, caught));
    }
  }, [ask, row, label]);
  const openWorkspace = useCallback(
    () => onOpenWorkspace?.(row.roomId),
    [onOpenWorkspace, row.roomId],
  );
  const openBoard = useCallback(() => onOpenBoard(row.roomId), [onOpenBoard, row.roomId]);
  const hint = reviewHint(row, wakesPaused);
  return (
    <View style={styles.reviewRow}>
      <Text accessibilityRole="header" style={styles.sheetText}>
        {row.title}
      </Text>
      <View style={styles.standupMeta}>
        <Text style={styles.rowMeta}>{row.meta}</Text>
        <ExternalLink href={row.url} accessibilityLabel={`Open ${row.title}`}>
          {row.linkText}
        </ExternalLink>
      </View>
      <Text style={row.troubled ? styles.standupBlocker : styles.muted}>{row.status}</Text>
      {row.asked ? <Asked asked={row.asked} styles={styles} /> : null}
      <View style={styles.actions}>
        {row.reviewer ? (
          <ActionButton
            label={label}
            pendingLabel="Asking..."
            onPress={request}
            disabled={wakesPaused}
            styles={styles}
          />
        ) : null}
        {onOpenWorkspace ? (
          <ActionButton
            label="Open workspace"
            pendingLabel="Opening..."
            onPress={openWorkspace}
            styles={styles}
          />
        ) : null}
        {row.asked ? (
          <ActionButton
            label="Open board"
            pendingLabel="Opening..."
            onPress={openBoard}
            styles={styles}
          />
        ) : null}
      </View>
      {failure ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      ) : null}
      {hint ? <Text style={styles.rowMeta}>{hint}</Text> : null}
    </View>
  );
}

export interface ReviewCardProps {
  rows: readonly ReviewRow[];
  open: boolean;
  /** Posts the request for a review on the pull request's board, naming the row's reviewer. */
  ask(row: ReviewRow): Promise<void>;
  /** "Wake agents" is off: a request would wait, so nobody is asked. */
  wakesPaused: boolean;
  /** Shows the workspace, where the app has the diff; undefined where the host cannot. */
  onOpenWorkspace: ((roomId: string) => void) | undefined;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The review queue: every open pull request of a workspace, what stands in its way, and the
 * ways on from here. The diff is in the workspace, the verdict is given on the forge, and an
 * agent of the team can be asked for a review, which comes back as a note.
 */
export function ReviewCard({
  rows,
  open,
  ask,
  wakesPaused,
  onOpenWorkspace,
  onOpenBoard,
  styles,
  onClose,
}: ReviewCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Reviews" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <View style={styles.sheetActions}>
            <Text style={styles.muted}>{reviewSummary(rows)}</Text>
            <Text style={styles.rowMeta}>{REVIEW_HELP}</Text>
          </View>
          {rows.length === 0 ? null : (
            <View style={styles.standupTeams}>
              {rows.map((row, index) => (
                <Fragment key={row.roomId}>
                  {index === 0 ? null : <View style={styles.rowDivider} />}
                  <Row
                    row={row}
                    wakesPaused={wakesPaused}
                    ask={ask}
                    onOpenWorkspace={onOpenWorkspace}
                    onOpenBoard={onOpenBoard}
                    styles={styles}
                  />
                </Fragment>
              ))}
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
