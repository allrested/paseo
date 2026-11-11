import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { AttentionEntry, AttentionReason } from "./model.js";
import type { OfficeStyles } from "./styles.js";

export function reasonLabel(reason: AttentionReason): string {
  return reason === "permission" ? "Needs permission" : "Error";
}

interface AttentionItemProps {
  entry: AttentionEntry;
  styles: OfficeStyles;
  onSelect(agentId: string): void;
}

/** A small agent row: the dot, the title, and the reason in words under it. */
function AttentionItem({ entry, styles, onSelect }: AttentionItemProps) {
  const press = useCallback(() => onSelect(entry.agentId), [entry.agentId, onSelect]);
  const itemStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) =>
      pressed ? styles.stripItemPressed : styles.stripItem,
    [styles],
  );
  const reason = reasonLabel(entry.reason);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}: ${reason}`}
      onPress={press}
      style={itemStyle}
    >
      <View style={styles.lead}>
        <View style={entry.reason === "permission" ? styles.dot.warning : styles.dot.danger} />
      </View>
      <View style={styles.stripBody}>
        <Text style={styles.stripTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.stripReason[entry.reason]} numberOfLines={1}>
          {reason}
        </Text>
      </View>
    </Pressable>
  );
}

export interface AttentionStripProps {
  entries: readonly AttentionEntry[];
  styles: OfficeStyles;
  onSelect(agentId: string): void;
}

/** The agents that need the user. On a phone this is the fast path. */
export function AttentionStrip({ entries, styles, onSelect }: AttentionStripProps) {
  if (entries.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {entries.map((entry) => (
        <AttentionItem key={entry.agentId} entry={entry} styles={styles} onSelect={onSelect} />
      ))}
    </ScrollView>
  );
}
