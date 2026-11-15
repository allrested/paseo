import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type PressableStateCallbackType,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { type PluginFile, type PluginFilePanelProps, useFileText } from "@getpaseo/plugin/client";
import { FlatList, Icon, Loading, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { Message } from "../message.js";
import { TABLE_MAX_BYTES, readProblem, tooLarge } from "../reading.js";
import type { ViewerStyles } from "../styles.js";
import { usePanelStyles } from "../use-styles.js";
import { rowCount, sortIcon, sortLabel } from "./labels.js";
import { columnWidths, numberWidth } from "./layout.js";
import {
  arrange,
  nextSort,
  numericColumns,
  searchWords,
  searchable,
  type Direction,
  type Sort,
} from "./order.js";
import { readTable, type Table } from "./parse.js";

/** The styles of one table: the shared ones at each column's width. */
interface Columns {
  number: TextStyle;
  heads: ViewStyle[];
  headsPressed: ViewStyle[];
  cells: TextStyle[];
}

interface HeadProps {
  name: string;
  column: number;
  direction: Direction | null;
  numeric: boolean;
  columns: Columns;
  styles: ViewerStyles;
  onSort(column: number): void;
}

function Head({ name, column, direction, numeric, columns, styles, onSort }: HeadProps) {
  const press = useCallback(() => onSort(column), [column, onSort]);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) =>
      pressed ? columns.headsPressed[column] : columns.heads[column],
    [columns, column],
  );
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={sortLabel(name, direction)}
      style={style}
    >
      <Text numberOfLines={1} style={numeric ? styles.headTextNumber : styles.headText}>
        {name}
      </Text>
      <Icon
        name={sortIcon(direction)}
        size={14}
        color={direction === null ? styles.iconColor : styles.sortedColor}
      />
    </Pressable>
  );
}

interface RowProps {
  /** The row's place in the file, from 0. */
  index: number;
  cells: readonly string[];
  /** Shown in full: every cell on as many lines as it has. */
  open: boolean;
  columns: Columns;
  styles: ViewerStyles;
  onToggle(index: number): void;
}

const Row = memo(function Row({ index, cells, open, columns, styles, onToggle }: RowProps) {
  const press = useCallback(() => onToggle(index), [index, onToggle]);
  return (
    // A cell is cut to its column on one line; pressing its row shows the row in full.
    <Pressable onPress={press} accessibilityRole="button" aria-expanded={open} style={styles.row}>
      <Text numberOfLines={1} style={columns.number}>
        {index + 1}
      </Text>
      {cells.map((cell, column) => (
        // A column has no id but its place.
        // oxlint-disable-next-line react/no-array-index-key
        <Text key={column} numberOfLines={open ? undefined : 1} style={columns.cells[column]}>
          {cell}
        </Text>
      ))}
    </Pressable>
  );
});

const NO_TEXTS: readonly string[] = [];
const rowKey = (index: number) => String(index);

interface TableViewProps {
  table: Table;
  styles: ViewerStyles;
}

function TableView({ table, styles }: TableViewProps) {
  const numeric = useMemo(() => numericColumns(table), [table]);
  const [query, setQuery] = useState("");
  // A long table takes a moment to search: the field stays ahead of the rows.
  const words = useMemo(() => searchWords(query), [query]);
  const lateWords = useDeferredValue(words);
  const searching = lateWords.length > 0;
  const texts = useMemo(() => (searching ? searchable(table) : NO_TEXTS), [table, searching]);
  const [chosen, setSort] = useState<Sort | null>(null);
  // The file may change under the tab and lose the sorted column.
  const sort = chosen !== null && chosen.column < table.columns.length ? chosen : null;
  const shown = useMemo(
    () => arrange(table, { words: lateWords, texts, sort, numeric }),
    [table, lateWords, texts, sort, numeric],
  );
  const onSort = useCallback((column: number) => setSort((now) => nextSort(now, column)), []);
  const [open, setOpen] = useState<number | null>(null);
  const onToggle = useCallback(
    (index: number) => setOpen((now) => (now === index ? null : index)),
    [],
  );

  const columns = useMemo((): Columns => {
    const widths = columnWidths(table);
    const at = <Style,>(style: Style, column: number): Style => ({
      ...style,
      width: widths[column],
    });
    return {
      number: { ...styles.number, width: numberWidth(table.rows.length) },
      heads: widths.map((_, column) => at(styles.head, column)),
      headsPressed: widths.map((_, column) => at(styles.headPressed, column)),
      cells: widths.map((_, column) =>
        at(numeric[column] ? styles.cellNumber : styles.cell, column),
      ),
    };
  }, [table, numeric, styles]);

  // Every row but the one shown in full has one height, which tells the list how long it is
  // before it has drawn its rows: the scroll bar spans the whole file.
  const { rowHeight } = styles;
  const rowLayout = useCallback(
    (_rows: unknown, index: number) => ({ length: rowHeight, offset: rowHeight * index, index }),
    [rowHeight],
  );
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<number>) => (
      <Row
        index={item}
        cells={table.rows[item]}
        open={open === item}
        columns={columns}
        styles={styles}
        onToggle={onToggle}
      />
    ),
    [table, open, columns, styles, onToggle],
  );

  return (
    <View style={styles.panel}>
      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="Search the table"
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={styles.placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {rowCount(shown.length, table.rows.length)}
        </Text>
      </View>
      <ScrollView horizontal style={styles.sideways} contentContainerStyle={styles.sidewaysContent}>
        <View style={styles.grid}>
          <View style={styles.headRow}>
            <Text style={columns.number}>#</Text>
            {table.columns.map((name, column) => (
              <Head
                // A column has no id but its place: two may share a name.
                // oxlint-disable-next-line react/no-array-index-key
                key={column}
                name={name}
                column={column}
                direction={sort?.column === column ? sort.direction : null}
                numeric={numeric[column]}
                columns={columns}
                styles={styles}
                onSort={onSort}
              />
            ))}
          </View>
          {shown.length === 0 ? (
            <Text style={styles.note}>
              {table.rows.length === 0
                ? "The file names its columns and has no rows."
                : `No rows match "${query.trim()}"`}
            </Text>
          ) : (
            <FlatList
              data={shown}
              renderItem={renderRow}
              keyExtractor={rowKey}
              getItemLayout={rowLayout}
              extraData={open}
              initialNumToRender={40}
              style={styles.rows}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

interface ReadingProps {
  file: PluginFile;
  styles: ViewerStyles;
}

function Reading({ file, styles }: ReadingProps) {
  const read = useFileText(file);
  const text = read.status === "ready" ? read.text : null;
  const { extension } = file;
  const table = useMemo(
    () => (text === null ? null : readTable(extension, text)),
    [extension, text],
  );
  if (read.status === "loading") return <Loading />;
  if (read.status === "error") {
    return <Message text={readProblem(read.error)} failed styles={styles} />;
  }
  if (table === null || table.columns.length === 0) {
    return <Message text="This file is empty." styles={styles} />;
  }
  return <TableView table={table} styles={styles} />;
}

/** A .csv or .tsv file as a table: its first line names the columns. */
export function TablePanel(props: PluginFilePanelProps) {
  const styles = usePanelStyles(props);
  const { file } = props;
  // The size is known before a read, and a file too large to hold as a table is not read.
  if (file.size > TABLE_MAX_BYTES) {
    return <Message text={tooLarge("a table", file.size, TABLE_MAX_BYTES)} styles={styles} />;
  }
  return <Reading file={file} styles={styles} />;
}
