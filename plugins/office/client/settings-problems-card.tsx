import { useCallback } from "react";
import { Text, View } from "react-native";
import { Modal } from "@getpaseo/plugin/client/ui";
import type { OfficeStyles } from "./styles.js";

export interface SettingsProblemsCardProps {
  /** What the host could not do with the office's settings, one sentence each. */
  problems: readonly string[];
  open: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * What the strip's Settings card opens. A plugin cannot open a screen of the app's Settings, so
 * the card says what failed and where the setting is.
 */
export function SettingsProblemsCard({
  problems,
  open,
  styles,
  onClose,
}: SettingsProblemsCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Office settings" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          {problems.map((problem) => (
            <Text key={problem} accessibilityRole="alert" style={styles.actionError}>
              {problem}
            </Text>
          ))}
          <Text style={styles.rowMeta}>Change it in Settings, under Office.</Text>
        </View>
      </Modal.Content>
    </Modal>
  );
}
