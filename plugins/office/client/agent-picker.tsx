import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { ActionButton } from "./action-button.js";
import { NOBODY, pickerGroups, showsSearch } from "./agent-picker-text.js";
import type { DotTone, OfficeRoom } from "./model.js";
import type { OfficeStyles } from "./styles.js";
import { focusById, listenForSpace } from "./web-env.web.js";

interface RowProps {
  value: string;
  title: string;
  detail: string;
  /** Null for the row that is nobody: it has no state to show. */
  tone: DotTone | null;
  selected: boolean;
  /** The page opened on this row: it takes the keyboard's focus. */
  takesFocus: boolean;
  onChoose(value: string): void;
  styles: OfficeStyles;
}

/** One choice of the page: a radio drawn as a row. */
function Row({ value, title, detail, tone, selected, takesFocus, onChoose, styles }: RowProps) {
  const press = useCallback(() => onChoose(value), [onChoose, value]);
  // Enter presses any Pressable; Space, the key that picks a radio, only a button.
  const id = useId();
  useEffect(() => listenForSpace(id, press), [id, press]);
  // The form's row that opened the page is gone: without this the focus falls to the page's body.
  useEffect(() => {
    if (takesFocus) focusById(id);
  }, [id, takesFocus]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  return (
    <Pressable
      id={id}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={`${title}: ${detail}`}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={selected ? styles.pickerRowSelected : styles.pickerRow}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      {/* The slot keeps the dot's width for nobody too, so every title starts on one rail. */}
      <View style={styles.pickerLead}>
        {tone === null ? null : <View style={styles.dot[tone]} />}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.sheetText} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

export interface AgentPickerProps {
  /** Every room of the office. */
  rooms: readonly OfficeRoom[];
  /** The board's room: its agents come first. */
  roomId: string;
  /** The chosen agent's id, or NOBODY. */
  value: string;
  /** A row was pressed: the page's owner takes the choice and shows the form again. */
  onChoose(value: string): void;
  onBack(): void;
  styles: OfficeStyles;
}

/** The page of a board's sheet that chooses who a post wakes. */
export function AgentPicker({ rooms, roomId, value, onChoose, onBack, styles }: AgentPickerProps) {
  const [query, setQuery] = useState("");
  const searchable = showsSearch(rooms);
  const groups = useMemo(
    () => pickerGroups(rooms, roomId, searchable ? query : ""),
    [rooms, roomId, query, searchable],
  );
  return (
    <View style={styles.sheet}>
      <View style={styles.actions}>
        <ActionButton label="Back" pendingLabel="Back" onPress={onBack} styles={styles} />
      </View>
      {searchable ? (
        <TextInput
          accessibilityLabel="Search agents"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by agent or room"
          placeholderTextColor={styles.placeholderColor}
          // On native the keyboard would rise over the list; the host autofocuses on web only too.
          autoFocus={Platform.OS === "web"}
          style={styles.pickerSearch}
        />
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Wake an agent with it"
        style={styles.sheet}
      >
        <View style={styles.pickerRows}>
          <Row
            value={NOBODY}
            title="Nobody"
            detail="The post wakes no agent"
            tone={null}
            selected={value === NOBODY}
            takesFocus={!searchable && value === NOBODY}
            onChoose={onChoose}
            styles={styles}
          />
        </View>
        {groups.map((group) => (
          <View key={group.label} style={styles.sheetField}>
            <Text style={styles.sheetLabel}>{group.label}</Text>
            <View style={styles.pickerRows}>
              {group.rows.map((row) => (
                <Row
                  key={row.agentId}
                  value={row.agentId}
                  title={row.title}
                  detail={row.detail}
                  tone={row.tone}
                  selected={value === row.agentId}
                  takesFocus={!searchable && value === row.agentId}
                  onChoose={onChoose}
                  styles={styles}
                />
              ))}
            </View>
          </View>
        ))}
        {searchable && query.trim() !== "" && groups.length === 0 ? (
          <Text style={styles.muted}>No agent matches.</Text>
        ) : null}
      </View>
    </View>
  );
}
