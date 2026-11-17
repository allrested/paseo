import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ExternalLink, Modal } from "@getpaseo/plugin/client/ui";
import type { IncidentsState } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { incidentProblems, incidentRows, type IncidentRow } from "./incidents-text.js";
import type { OfficeStyles } from "./styles.js";
import type { DismissIncidents } from "./use-incidents.js";

interface RowProps {
  row: IncidentRow;
  onDismiss: DismissIncidents;
  styles: OfficeStyles;
}

function Row({ row, onDismiss, styles }: RowProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Dismiss keeps its failure under its button; the link's goes under the row.
  const [failure, setFailure] = useState<string | null>(null);
  const openFailed = useCallback(
    (caught: unknown) => {
      if (mounted.current) setFailure(failureText(`Open ${row.key}`, caught));
    },
    [row.key],
  );
  const dismiss = useCallback(() => onDismiss([row.id]), [onDismiss, row.id]);
  return (
    <View style={styles.machineRow}>
      <ExternalLink
        href={row.url}
        accessibilityLabel={`Open ${row.key} in ${row.sourceLabel}`}
        onError={openFailed}
      >
        {row.title}
      </ExternalLink>
      <Text style={styles.rowMeta}>{`${row.sourceLabel} ${row.key} · ${row.age}`}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Dismiss"
          pendingLabel="Dismissing..."
          onPress={dismiss}
          styles={styles}
        />
      </View>
      {failure ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

export interface IncidentsCardProps {
  /** The incidents in the office's snapshot; absent until the host has read them. */
  state: IncidentsState | undefined;
  open: boolean;
  /** When the card opened: the ages are counted to it. */
  now: number;
  onDismiss: DismissIncidents;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The open incidents, newest first, each with a link to its issue and Dismiss; "Dismiss all"
 * under them, and a line for each tracker whose check failed. A dismissed incident leaves once
 * the host says so.
 */
export function IncidentsCard({
  state,
  open,
  now,
  onDismiss,
  styles,
  onClose,
}: IncidentsCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const rows = useMemo(() => incidentRows(state, now), [state, now]);
  const problems = useMemo(() => incidentProblems(state), [state]);
  const dismissAll = useCallback(() => onDismiss(), [onDismiss]);
  return (
    <Modal title="Incidents" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          {rows.length === 0 ? (
            <Text style={styles.muted}>No open incidents</Text>
          ) : (
            <View style={styles.janitorRows}>
              {rows.map((row) => (
                <Row key={row.id} row={row} onDismiss={onDismiss} styles={styles} />
              ))}
            </View>
          )}
          {rows.length === 0 ? null : (
            <View style={styles.actions}>
              <ActionButton
                label="Dismiss all"
                pendingLabel="Dismissing..."
                onPress={dismissAll}
                styles={styles}
              />
            </View>
          )}
          {problems.map((problem) => (
            <Text key={problem} accessibilityRole="alert" style={styles.actionError}>
              {problem}
            </Text>
          ))}
        </View>
      </Modal.Content>
    </Modal>
  );
}
