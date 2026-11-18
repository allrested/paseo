// plugins/office/client/column-sheet.tsx
import { useCallback, useEffect, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { COLUMN_TABS, type ColumnTab } from "./column-model.js";
import { ColumnTabs, type ColumnBadges } from "./office-column.js";
import type { OfficeStyles } from "./styles.js";

export interface ColumnSheetProps {
  /** The tab the sheet shows; null while it is closed. */
  open: ColumnTab | null;
  badges: ColumnBadges;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  /** "web" listens for Escape; an app has no keyboard to listen to. */
  platform: "ios" | "android" | "web";
  onOpen(tab: ColumnTab): void;
  onClose(): void;
  styles: OfficeStyles;
  /** The floor the sheet lies over; the bar is under it, outside the sheet's reach. */
  floor: ReactNode;
  /** The open tab's panel. */
  children: ReactNode;
}

/**
 * The column on a phone: a bar of its tabs under the floor, and the chosen tab as a sheet over
 * the floor. The office draws both, as it draws the column, so they are there in every app. The
 * sheet is placed against the floor's box, so its bottom is the bar's top and the bar stays
 * pressable while the sheet is open.
 */
export function ColumnSheet({
  open,
  badges,
  color,
  iconSize,
  platform,
  onOpen,
  onClose,
  styles,
  floor,
  children,
}: ColumnSheetProps) {
  // The open tab's own press closes the sheet, as a second press on a toggle does.
  const press = useCallback(
    (tab: ColumnTab) => {
      if (tab === open) onClose();
      else onOpen(tab);
    },
    [open, onOpen, onClose],
  );
  useEffect(() => {
    if (platform !== "web" || open === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [platform, open, onClose]);
  const title = COLUMN_TABS.find((each) => each.tab === open)?.label ?? "";
  return (
    <>
      <View style={styles.floor}>
        {floor}
        {open === null ? null : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the column"
              onPress={onClose}
              style={styles.sheetScrim}
            />
            <View style={styles.columnSheet}>
              <View style={styles.columnSheetHead}>
                <Text accessibilityRole="header" style={styles.columnSheetTitle}>
                  {title}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={onClose}
                  style={styles.segment}
                >
                  <Icon name="X" size={iconSize} color={color} />
                </Pressable>
              </View>
              <View style={styles.columnBody}>{children}</View>
            </View>
          </>
        )}
      </View>
      <View style={styles.columnBar}>
        <ColumnTabs
          tab={open}
          badges={badges}
          color={color}
          iconSize={iconSize}
          labels={false}
          vertical={false}
          onPress={press}
          styles={styles}
        />
      </View>
    </>
  );
}
