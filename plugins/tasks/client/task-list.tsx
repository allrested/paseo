import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import type { TaskRow } from "../shared/contracts.js";
import { Button } from "./button.js";
import { useDebounced, useNow } from "./device.js";
import { emptyList, rowLabel, rowMeta } from "./format.js";
import type { TasksStyles } from "./tasks-styles.js";
import { useTaskList, type TaskListState } from "./use-tasks.js";

/** Typing asks the trackers once the words have stopped changing for this long. */
const SEARCH_DELAY_MS = 300;

// On a phone, opening a task leaves the list and coming back mounts it again: what was typed
// is put back.
let typed = "";

/** For tests: one test's search must not open the next. */
export function forgetSearch(): void {
  typed = "";
}

interface RowProps {
  row: TaskRow;
  first: boolean;
  selected: boolean;
  now: number;
  styles: TasksStyles;
  onOpen(id: string): void;
}

function Row({ row, first, selected, now, styles, onOpen }: RowProps) {
  const open = useCallback(() => onOpen(row.id), [onOpen, row.id]);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      first ? styles.row : styles.rowDivided,
      selected || pressed ? styles.rowSelected : null,
    ],
    [first, selected, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rowLabel(row)}
      aria-selected={selected}
      onPress={open}
      style={style}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          <Text style={styles.rowKey}>{row.key}</Text>
          {` ${row.title}`}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {rowMeta(row, now)}
        </Text>
      </View>
      <Icon name="ChevronRight" size={16} color={styles.iconColor} />
    </Pressable>
  );
}

interface SectionProps extends Omit<RowProps, "row" | "first" | "selected"> {
  title: string;
  rows: readonly TaskRow[];
  selected: string | null;
}

function Section({ title, rows, selected, ...row }: SectionProps) {
  if (rows.length === 0) return null;
  return (
    <View style={row.styles.section}>
      <Text accessibilityRole="header" style={row.styles.sectionTitle}>
        {title}
      </Text>
      <View style={row.styles.card}>
        {rows.map((item, index) => (
          <Row
            key={item.id}
            row={item}
            first={index === 0}
            selected={item.id === selected}
            {...row}
          />
        ))}
      </View>
    </View>
  );
}

interface BodyProps extends Omit<SectionProps, "title" | "rows"> {
  list: TaskListState;
  query: string;
  onConnect(): void;
}

function Body({ list, query, onConnect, ...section }: BodyProps) {
  const { styles } = section;
  const { value, error } = list;
  if (value === null) {
    if (error === null) return <Text style={styles.muted}>Loading...</Text>;
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        <Button label="Try again" onPress={list.reload} styles={styles} />
      </View>
    );
  }
  if (!value.configured) {
    return (
      <View style={styles.block}>
        <Text style={styles.muted}>No tracker is connected</Text>
        <Button label="Connect Jira or GitLab" onPress={onConnect} styles={styles} />
      </View>
    );
  }
  const failures = error === null ? value.problems : [error, ...value.problems];
  return (
    <>
      {failures.length === 0 ? null : (
        <View accessibilityRole="alert" style={styles.banner}>
          {failures.map((failure) => (
            <Text key={failure} style={styles.error}>
              {failure}
            </Text>
          ))}
        </View>
      )}
      {value.issues.length + value.mergeRequests.length === 0 ? (
        <Text style={styles.muted}>{emptyList(query)}</Text>
      ) : null}
      <Section title="Issues" rows={value.issues} {...section} />
      <Section title="Merge requests" rows={value.mergeRequests} {...section} />
    </>
  );
}

export interface TaskListProps {
  styles: TasksStyles;
  /** The open task; its row is marked. */
  selected: string | null;
  onOpen(id: string): void;
  /** Opens the screen where the trackers are connected. */
  onConnect(): void;
}

/** The signed-in user's open issues and merge requests, with a search over their titles. */
export function TaskList({ styles, selected, onOpen, onConnect }: TaskListProps) {
  const [text, setText] = useState(typed);
  useEffect(() => {
    typed = text;
  }, [text]);
  const query = useDebounced(text.trim(), SEARCH_DELAY_MS);
  const list = useTaskList(query);
  const now = useNow();
  return (
    <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search tasks"
          value={text}
          onChangeText={setText}
          placeholder="Search by key or title"
          placeholderTextColor={styles.placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh the list"
          disabled={list.loading}
          onPress={list.reload}
          style={list.loading ? styles.iconButtonBusy : styles.iconButton}
        >
          <Icon name="RefreshCw" size={16} color={styles.iconColor} />
        </Pressable>
      </View>
      <Body
        list={list}
        query={query}
        selected={selected}
        now={now}
        styles={styles}
        onOpen={onOpen}
        onConnect={onConnect}
      />
    </ScrollView>
  );
}
