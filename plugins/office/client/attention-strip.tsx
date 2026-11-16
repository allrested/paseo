import { useCallback, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
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

/** A card of the office in the strip: its name, what it says in a few words, and its opening. */
export interface StripCard {
  title: string;
  note: HostNote;
  onOpen(): void;
}

interface NoteItemProps extends StripCard {
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
  /** The office's cards that have something to say, in their order. They come after the agents. */
  cards: readonly StripCard[];
  styles: OfficeStyles;
  /** A wide screen: the entries wrap onto more rows. A phone: they scroll sideways, with a fade. */
  wrap: boolean;
  onSelect(agentId: string): void;
}

export interface StripScroll {
  viewport: number;
  content: number;
  offset: number;
}

/** More entries are past the right edge, by more than the 1 dp a whole-pixel offset can miss. */
export function fadeShown({ viewport, content, offset }: StripScroll): boolean {
  return viewport > 0 && offset + viewport < content - 1;
}

/** The agents that need the user, then the office's cards. On a phone this is the fast path. */
export function AttentionStrip({ entries, cards, styles, wrap, onSelect }: AttentionStripProps) {
  const [scroll, setScroll] = useState<StripScroll>({ viewport: 0, content: 0, offset: 0 });
  const layout = useCallback((event: LayoutChangeEvent) => {
    const viewport = event.nativeEvent.layout.width;
    setScroll((current) => ({ ...current, viewport }));
  }, []);
  const sized = useCallback((content: number) => {
    setScroll((current) => ({ ...current, content }));
  }, []);
  const scrolled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.x;
    setScroll((current) => ({ ...current, offset }));
  }, []);
  if (entries.length === 0 && cards.length === 0) return null;
  const items = (
    <>
      {entries.map((entry) => (
        <AttentionItem key={entry.agentId} entry={entry} styles={styles} onSelect={onSelect} />
      ))}
      {cards.map((card) => (
        <NoteItem
          key={card.title}
          title={card.title}
          note={card.note}
          styles={styles}
          onOpen={card.onOpen}
        />
      ))}
    </>
  );
  if (wrap) {
    return (
      <View style={styles.stripRail}>
        <View style={styles.stripWrap}>{items}</View>
      </View>
    );
  }
  return (
    <View style={styles.stripRail} onLayout={layout}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripScroll}
        contentContainerStyle={styles.strip}
        onContentSizeChange={sized}
        onScroll={scrolled}
        scrollEventThrottle={16}
      >
        {items}
      </ScrollView>
      {fadeShown(scroll) ? (
        <View style={styles.stripFade}>
          {styles.stripFadeSteps.map((step) => (
            // (the kit has no gradient: a few strips of the surface, each more opaque)
            <View key={step.opacity} style={step.style} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
