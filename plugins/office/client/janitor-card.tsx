import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { Modal } from "@getpaseo/plugin/client/ui";
import { ActionButton, failureText } from "./action-button.js";
import { contextTone, inShownOrder, janitorRowLabel, type JanitorRow } from "./context-text.js";
import type { OfficeStyles } from "./styles.js";
import type { Tidy } from "./use-janitor.js";

// The plugin kit has no confirm dialog; as in Saved prompts, a second press within this window
// is the yes.
const CONFIRM_MS = 5000;

/** The first press arms and answers false; the second, within the window, answers true. */
function useConfirm(): { armed: boolean; press(): boolean } {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const press = useCallback(() => {
    setArmed(!armed);
    return armed;
  }, [armed]);
  return { armed, press };
}

interface RowProps {
  row: JanitorRow;
  tidy: Tidy;
  styles: OfficeStyles;
}

function Row({ row, tidy, styles }: RowProps) {
  const confirm = useConfirm();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The two buttons share a row, so a refusal goes under the row, at the row's width.
  const [failure, setFailure] = useState<string | null>(null);
  const run = useCallback(
    async (action: "clean" | "reset", label: string) => {
      setFailure(null);
      try {
        await tidy(row.agentId, action);
      } catch (caught) {
        if (mounted.current) setFailure(failureText(label, caught));
      }
    },
    [tidy, row.agentId],
  );
  const clean = useCallback(() => run("clean", "Clean context"), [run]);
  const reset = useCallback(() => {
    if (!confirm.press()) return undefined;
    return run("reset", "Reset session");
  }, [confirm, run]);
  const tone = contextTone(row.percent);
  const fill = useMemo(
    (): ViewStyle[] => [styles.machineFill[tone], { width: `${row.percent ?? 0}%` }],
    [styles, tone, row.percent],
  );
  return (
    <View style={styles.machineRow}>
      <View
        accessible
        accessibilityLabel={janitorRowLabel(row)}
        accessibilityRole="text"
        style={styles.janitorBody}
      >
        <View style={styles.machineRowHead}>
          <Text style={styles.machineRowTitle} numberOfLines={1}>
            {row.title}
          </Text>
          {row.percent === null ? null : <Text style={styles.machineValue}>{row.percent}%</Text>}
        </View>
        {row.percent === null ? null : (
          <View style={styles.machineTrack}>
            <View style={styles.machineTrackBase} />
            <View style={fill} />
          </View>
        )}
        <Text style={styles.rowMeta}>
          {row.state} · {row.detail}
        </Text>
      </View>
      {row.tidy ? (
        <View style={styles.actions}>
          <ActionButton
            label="Clean context"
            pendingLabel="Sending..."
            onPress={clean}
            styles={styles}
          />
          <ActionButton
            label={confirm.armed ? "Confirm reset" : "Reset session"}
            pendingLabel="Sending..."
            onPress={reset}
            styles={styles}
          />
        </View>
      ) : null}
      {failure ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      ) : null}
      {confirm.armed ? (
        <Text accessibilityRole="alert" style={styles.rowMeta}>
          Press again within {CONFIRM_MS / 1000} s. The agent forgets this conversation; its files
          and commits stay.
        </Text>
      ) : null}
    </View>
  );
}

export interface JanitorCardProps {
  rows: readonly JanitorRow[];
  open: boolean;
  tidy: Tidy;
  styles: OfficeStyles;
  onClose(): void;
}

/** Every agent's context, the fullest first, and the two ways to tidy one. */
export function JanitorCard({ rows, open, tidy, styles, onClose }: JanitorCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  // The fullest first when the card opens; while it is open the rows stay where they are.
  const shown = useRef<string[]>([]);
  const ordered = useMemo(() => (open ? inShownOrder(shown.current, rows) : rows), [open, rows]);
  useEffect(() => {
    shown.current = open ? ordered.map((row) => row.agentId) : [];
  }, [open, ordered]);
  return (
    <Modal title="Janitor" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <Text style={styles.rowMeta}>
            Clean context compacts the conversation into a summary. Reset session starts a new
            conversation, and the agent forgets the old one. An agent at work is tidied once its
            turn has ended.
          </Text>
          {ordered.length === 0 ? (
            <Text style={styles.muted}>No agents on this host yet.</Text>
          ) : (
            <View style={styles.janitorRows}>
              {ordered.map((row) => (
                <Row key={row.agentId} row={row} tidy={tidy} styles={styles} />
              ))}
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
