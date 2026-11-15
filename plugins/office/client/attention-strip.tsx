import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { HostNote } from "./machine-text.js";
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
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  const reason = reasonLabel(entry.reason);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}: ${reason}`}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={lit ? styles.stripItemPressed : styles.stripItem}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
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

const HOST_DOT = { muted: "idle", warning: "warning", danger: "danger" } as const;

/** What the strip says of the host or of the janitor, and the card it opens. */
export interface StripNote {
  note: HostNote;
  onOpen(): void;
}

interface NoteItemProps extends StripNote {
  title: string;
  styles: OfficeStyles;
}

/** A card of the office in the strip's own shape: a dot, its name, and its note. Opens the card. */
function NoteItem({ title, note, styles, onOpen }: NoteItemProps) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${note.text}`}
      onPress={onOpen}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={lit ? styles.stripItemPressed : styles.stripItem}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      <View style={styles.lead}>
        <View style={styles.dot[HOST_DOT[note.tone]]} />
      </View>
      <View style={styles.stripBody}>
        <Text style={styles.stripTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.stripNote[note.tone]} numberOfLines={1}>
          {note.text}
        </Text>
      </View>
    </Pressable>
  );
}

export interface AttentionStripProps {
  entries: readonly AttentionEntry[];
  /** The host's note; null on a host that cannot be read. It comes after the agents. */
  host: StripNote | null;
  /** How full the contexts are; null in an office without agents. */
  janitor: StripNote | null;
  /** What blocks the teams; null in an office without agents. It comes last. */
  standup: StripNote | null;
  styles: OfficeStyles;
  onSelect(agentId: string): void;
}

/**
 * The agents that need the user, then the office's cards: the host, the janitor and the
 * stand-up. On a phone this is the fast path.
 */
export function AttentionStrip({
  entries,
  host,
  janitor,
  standup,
  styles,
  onSelect,
}: AttentionStripProps) {
  if (entries.length === 0 && host === null && janitor === null && standup === null) return null;
  return (
    <View style={styles.stripRail}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripScroll}
        contentContainerStyle={styles.strip}
      >
        {entries.map((entry) => (
          <AttentionItem key={entry.agentId} entry={entry} styles={styles} onSelect={onSelect} />
        ))}
        {host ? (
          <NoteItem title="Host" note={host.note} styles={styles} onOpen={host.onOpen} />
        ) : null}
        {janitor ? (
          <NoteItem title="Janitor" note={janitor.note} styles={styles} onOpen={janitor.onOpen} />
        ) : null}
        {standup ? (
          <NoteItem title="Stand-up" note={standup.note} styles={styles} onOpen={standup.onOpen} />
        ) : null}
      </ScrollView>
    </View>
  );
}
