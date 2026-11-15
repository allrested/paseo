import { useCallback, useRef } from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { CdpBrowserElementSelection } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { elementLabel } from "./element-attachment";

const ThemedNoteInput = withUnistyles(EditingTextInput);
const noteInputMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

/** A key press as the web reports it; native sends the key alone. */
type KeyPress = TextInputKeyPressEventData & { metaKey?: boolean; ctrlKey?: boolean };

interface Props {
  selection: CdpBrowserElementSelection;
  onSubmit(comment: string): void;
  onCancel(): void;
}

/**
 * Asks for a note about the picked element. It sits at the top of the pane, where a phone's
 * keyboard cannot cover it.
 */
export function CdpAnnotationCard({ selection, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const input = useRef<EditingTextInputHandle>(null);
  const submit = useCallback(() => onSubmit(input.current?.getText() ?? ""), [onSubmit]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<KeyPress>) => {
      const { key, metaKey, ctrlKey } = event.nativeEvent;
      if (key === "Escape") onCancel();
      else if (key === "Enter" && (metaKey || ctrlKey)) {
        event.preventDefault();
        submit();
      }
    },
    [onCancel, submit],
  );
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.card} testID="cdp-annotation-card">
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {t("workspace.browser.annotate.title")}
        </Text>
        <Text numberOfLines={1} style={styles.element}>
          {elementLabel(selection)}
        </Text>
        <ThemedNoteInput
          ref={input}
          accessibilityLabel={t("workspace.browser.annotate.placeholder")}
          autoFocus
          multiline
          onKeyPress={handleKeyPress}
          placeholder={t("workspace.browser.annotate.placeholder")}
          style={styles.input}
          uniProps={noteInputMapping}
        />
        <View style={styles.actions}>
          <Button variant="ghost" onPress={onCancel}>
            {t("workspace.browser.annotate.cancel")}
          </Button>
          <Button variant="default" onPress={submit}>
            {t("workspace.browser.annotate.submit")}
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    alignItems: "center",
    padding: theme.spacing[3],
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  element: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  input: {
    minHeight: 64,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
