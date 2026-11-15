import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { OfficeViewChoice } from "../shared/settings.js";
import type { OfficeStyles } from "./styles.js";

const LABELS: Readonly<Record<OfficeViewChoice, string>> = {
  "3d": "3D",
  "2d": "2D",
  list: "List",
};

interface SegmentProps {
  view: OfficeViewChoice;
  selected: boolean;
  disabled: boolean;
  onChange(next: OfficeViewChoice): void;
  styles: OfficeStyles;
}

function Segment({ view, selected, disabled, onChange, styles }: SegmentProps) {
  const press = useCallback(() => onChange(view), [onChange, view]);
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
      accessibilityRole="button"
      accessibilityLabel={`${LABELS[view]} view`}
      aria-selected={selected}
      disabled={disabled}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      <Text style={selected ? styles.segmentTextSelected : styles.segmentText}>{LABELS[view]}</Text>
    </Pressable>
  );
}

export interface ViewSwitchProps {
  /** The views this device can show, in the order they are offered. */
  options: readonly OfficeViewChoice[];
  /** Null while the device's choice is being read: nothing is chosen and nothing can be. */
  value: OfficeViewChoice | null;
  onChange(next: OfficeViewChoice): void;
  styles: OfficeStyles;
}

/**
 * The office's views as the app's segmented control
 * (packages/app/src/components/ui/segmented-control.tsx), which a plugin cannot render: pills in
 * a row, the chosen one filled, each a button that says whether it is chosen.
 */
export function ViewSwitch({ options, value, onChange, styles }: ViewSwitchProps) {
  return (
    <View
      role="group"
      aria-label="Office view"
      style={value === null ? styles.segmentsDisabled : styles.segments}
    >
      {options.map((view) => (
        <Segment
          key={view}
          view={view}
          selected={view === value}
          disabled={value === null}
          onChange={onChange}
          styles={styles}
        />
      ))}
    </View>
  );
}
