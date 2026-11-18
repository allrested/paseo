// plugins/office/client/column-sheet.tsx
import { useCallback, useEffect, type ReactNode } from "react";
import { KeyboardAvoidingView, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { COLUMN_TABS, type ColumnTab } from "./column-model.js";
import { ColumnTabs, type ColumnBadges } from "./office-column.js";
import type { OfficeStyles } from "./styles.js";

export interface ColumnSheetProps {
  /** The tab the sheet shows; null while it is closed. */
  open: ColumnTab | null;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  /** "web" listens for Escape; "ios" lifts the sheet's body over the keyboard. */
  platform: "ios" | "android" | "web";
  onClose(): void;
  styles: OfficeStyles;
  /** The open tab's panel. */
  children: ReactNode;
}

/**
 * The column on a phone, as a sheet over the floor: the scrim and the chosen tab's panel. The
 * surface draws it inside the floor's box, after the floor, so the sheet's bottom is the floor's
 * and the bar under the floor stays pressable while the sheet is open. The floor is the same view
 * in both layouts, so a flip between them does not draw the floor again.
 */
export function ColumnSheet({
  open,
  color,
  iconSize,
  platform,
  onClose,
  styles,
  children,
}: ColumnSheetProps) {
  useEffect(() => {
    if (platform !== "web" || open === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [platform, open, onClose]);
  if (open === null) return null;
  const title = COLUMN_TABS.find((each) => each.tab === open)?.label ?? "";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the column"
        onPress={onClose}
        style={styles.sheetScrim}
      />
      <View testID="office-column-sheet" style={styles.columnSheet}>
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
        {/* The Chat box sits at the sheet's bottom: on iOS the keyboard would cover it. */}
        <KeyboardAvoidingView
          behavior={platform === "ios" ? "padding" : undefined}
          style={styles.columnBody}
        >
          {children}
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

export interface ColumnBarProps {
  /** The tab the sheet shows; null while it is closed. */
  open: ColumnTab | null;
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  onOpen(tab: ColumnTab): void;
  onClose(): void;
  styles: OfficeStyles;
}

/** The phone's bar of the column's tabs, under the floor: a press opens that tab's sheet. */
export function ColumnBar({
  open,
  badges,
  color,
  iconSize,
  onOpen,
  onClose,
  styles,
}: ColumnBarProps) {
  // The open tab's own press closes the sheet, as a second press on a toggle does.
  const press = useCallback(
    (tab: ColumnTab) => {
      if (tab === open) onClose();
      else onOpen(tab);
    },
    [open, onOpen, onClose],
  );
  return (
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
  );
}
