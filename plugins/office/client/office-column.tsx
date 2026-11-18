import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { COLUMN_TABS, clampColumn, type ColumnTab } from "./column-model.js";
import type { OfficeStyles } from "./styles.js";
import type { ColumnState } from "./use-column.js";

export interface ColumnBadges {
  /** The Attention tab's cards; null at none. */
  attention: string | null;
  /** The chat's messages since it was last open on this device; null at none. */
  chat: string | null;
}

interface TabProps {
  tab: ColumnTab;
  label: string;
  icon: string;
  selected: boolean;
  count: string | null;
  showLabel: boolean;
  color: string;
  iconSize: number;
  onPress(tab: ColumnTab): void;
  styles: OfficeStyles;
}

function Tab({
  tab,
  label,
  icon,
  selected,
  count,
  showLabel,
  color,
  iconSize,
  onPress,
  styles,
}: TabProps) {
  const press = useCallback(() => onPress(tab), [onPress, tab]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (selected) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      aria-selected={selected}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      {/* The count sits on the icon's corner, inside the pill that clips. */}
      <View>
        <Icon name={icon} size={iconSize} color={color} />
        {count ? (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {showLabel ? (
        <Text style={selected ? styles.segmentTextSelected : styles.segmentText}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

export interface ColumnTabsProps {
  /** The chosen tab; null where none shows as chosen (the rail, the phone's bar while closed). */
  tab: ColumnTab | null;
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  /** Icons alone on the rail and the phone's bar; with the chosen tab's label in the column. */
  labels: boolean;
  vertical: boolean;
  onPress(tab: ColumnTab): void;
  styles: OfficeStyles;
}

/** The column's tabs: a row in the open column, a stack on its rail. */
export function ColumnTabs({
  tab,
  badges,
  color,
  iconSize,
  labels,
  vertical,
  onPress,
  styles,
}: ColumnTabsProps) {
  return (
    <View
      role="tablist"
      aria-label="Office column"
      style={vertical ? styles.columnTabsVertical : styles.columnTabs}
    >
      {COLUMN_TABS.map((each) => {
        let count: string | null = null;
        if (each.tab === "attention") count = badges.attention;
        if (each.tab === "chat") count = badges.chat;
        return (
          <Tab
            key={each.tab}
            tab={each.tab}
            label={each.label}
            icon={each.icon}
            selected={each.tab === tab}
            count={count}
            // Four labels do not fit a narrow column: the chosen tab alone says its name.
            showLabel={labels && each.tab === tab}
            color={color}
            iconSize={iconSize}
            onPress={onPress}
            styles={styles}
          />
        );
      })}
    </View>
  );
}

interface IconButtonProps {
  label: string;
  icon: string;
  color: string;
  iconSize: number;
  onPress(): void;
  styles: OfficeStyles;
}

function IconButton({ label, icon, color, iconSize, onPress, styles }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.segment}
    >
      <Icon name={icon} size={iconSize} color={color} />
    </Pressable>
  );
}

export interface OfficeColumnProps {
  column: ColumnState;
  /** The surface's width, for the column's most; 0 until measured. */
  surfaceWidth: number;
  badges: ColumnBadges;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  styles: OfficeStyles;
  /** The chosen tab's panel. */
  children: ReactNode;
}

/**
 * The office's column beside the floor: its tabs over the chosen panel, a handle to drag its
 * width, and a rail of the tabs' icons when it is collapsed. The office draws it itself, so it is
 * there in an app with no side area of its own.
 */
export function OfficeColumn({
  column,
  surfaceWidth,
  badges,
  color,
  iconSize,
  styles,
  children,
}: OfficeColumnProps) {
  const { tab, collapsed, show, setCollapsed, setWidth } = column;
  const width = clampColumn(column.width, surfaceWidth);
  // The width while the handle is dragged; the device is told once, on release.
  const [dragged, setDragged] = useState<number | null>(null);
  const start = useRef(width);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = width;
          setDragged(width);
        },
        // The handle is on the column's left: a drag to the left widens it.
        onPanResponderMove: (_event, gesture) =>
          setDragged(clampColumn(start.current - gesture.dx, surfaceWidth)),
        onPanResponderRelease: (_event, gesture) => {
          setDragged(null);
          setWidth(clampColumn(start.current - gesture.dx, surfaceWidth));
        },
        onPanResponderTerminate: () => setDragged(null),
      }),
    [width, surfaceWidth, setWidth],
  );
  const collapse = useCallback(() => setCollapsed(true), [setCollapsed]);
  const sized = useMemo(
    () => ({ ...styles.column, width: dragged ?? width }),
    [styles.column, dragged, width],
  );
  if (collapsed) {
    return (
      <View style={styles.columnRail}>
        <ColumnTabs
          tab={null}
          badges={badges}
          color={color}
          iconSize={iconSize}
          labels={false}
          vertical
          onPress={show}
          styles={styles}
        />
      </View>
    );
  }
  return (
    <>
      <View
        accessibilityLabel="Drag to resize the column"
        style={dragged === null ? styles.columnHandle : styles.columnHandleLit}
        {...pan.panHandlers}
      />
      <View style={sized}>
        <View style={styles.columnHead}>
          <ColumnTabs
            tab={tab}
            badges={badges}
            color={color}
            iconSize={iconSize}
            labels
            vertical={false}
            onPress={show}
            styles={styles}
          />
          <IconButton
            label="Collapse the column"
            icon="PanelRightClose"
            color={color}
            iconSize={iconSize}
            onPress={collapse}
            styles={styles}
          />
        </View>
        <View style={styles.columnBody}>{children}</View>
      </View>
    </>
  );
}
