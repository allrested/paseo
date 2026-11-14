import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  editRpc,
  type Change,
  type ColorToken,
  type EditAction,
  type Layer,
  type LayerRef,
} from "../shared/contracts.js";
import { failureText } from "./action-button.js";
import { Chip, IconButton, TextButton } from "./controls.js";
import type { DesignStyles } from "./styles.js";

/** What the inspector works on. `id` stays after a delete, so Undo can bring the layer back. */
export interface Editing {
  id: string;
  layer: Layer | null;
  here: LayerRef[];
  colors: ColorToken[];
}

type Tool = "text" | "fill" | "move" | "size" | "layer";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "fill", label: "Fill" },
  { id: "move", label: "Move" },
  { id: "size", label: "Size" },
  { id: "layer", label: "Layer" },
];
const STEPS = [
  { id: "1", label: "1 px" },
  { id: "10", label: "10 px" },
];
const DUPLICATE: Change = { kind: "duplicate" };
const DELETE: Change = { kind: "delete" };
const CHECKED = { checked: true };
const UNCHECKED = { checked: false };

interface Nudge {
  /** What a screen reader says, and what a failure names: "Move left". */
  label: string;
  icon?: string;
  /** Shown in place of an icon: "W +". */
  text?: string;
  change(step: number): Change;
}

const MOVES: Nudge[] = [
  { label: "Move left", icon: "ArrowLeft", change: (n) => ({ kind: "move", dx: -n, dy: 0 }) },
  { label: "Move up", icon: "ArrowUp", change: (n) => ({ kind: "move", dx: 0, dy: -n }) },
  { label: "Move down", icon: "ArrowDown", change: (n) => ({ kind: "move", dx: 0, dy: n }) },
  { label: "Move right", icon: "ArrowRight", change: (n) => ({ kind: "move", dx: n, dy: 0 }) },
];
const SIZES: Nudge[] = [
  { label: "Narrower", text: "W −", change: (n) => ({ kind: "resize", dw: -n, dh: 0 }) },
  { label: "Wider", text: "W +", change: (n) => ({ kind: "resize", dw: n, dh: 0 }) },
  { label: "Shorter", text: "H −", change: (n) => ({ kind: "resize", dw: 0, dh: -n }) },
  { label: "Taller", text: "H +", change: (n) => ({ kind: "resize", dw: 0, dh: n }) },
];

/** FigCraft's layer type in words: "ROUNDED_RECTANGLE" reads "Rounded rectangle". */
export function typeLabel(type: string): string {
  const words = type.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "color/accent" reads "accent" on its chip; the full name stays its label for a screen reader. */
function shortToken(name: string): string {
  return name.startsWith("color/") ? name.slice("color/".length) : name;
}

function facts(layer: Layer): string {
  const fill = layer.fill.token ? shortToken(layer.fill.token) : (layer.fill.color ?? "none");
  return `${typeLabel(layer.type)} · ${Math.round(layer.width)} × ${Math.round(layer.height)} · Fill ${fill}`;
}

function NudgeButton(props: {
  nudge: Nudge;
  step: number;
  disabled: boolean;
  styles: DesignStyles;
  onNudge(nudge: Nudge): void;
}) {
  const { nudge, styles, onNudge } = props;
  const press = useCallback(() => onNudge(nudge), [nudge, onNudge]);
  const render = useCallback(
    ({ pressed }: PressableStateCallbackType) => (
      <>
        {pressed ? <View style={styles.buttonFill} /> : null}
        {nudge.icon ? (
          <Icon name={nudge.icon} size={18} color={styles.nudgeColor} />
        ) : (
          <Text style={styles.nudgeText}>{nudge.text}</Text>
        )}
      </>
    ),
    [nudge, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${nudge.label} by ${props.step} px`}
      disabled={props.disabled}
      onPress={press}
      style={props.disabled ? styles.nudgeButtonDisabled : styles.nudgeButton}
    >
      {render}
    </Pressable>
  );
}

function ColorChip(props: {
  token: ColorToken;
  chosen: boolean;
  styles: DesignStyles;
  onChoose(name: string): void;
}) {
  const { token, styles, onChoose } = props;
  const press = useCallback(() => onChoose(token.name), [onChoose, token.name]);
  const swatch = useMemo(
    () => [styles.swatch, { backgroundColor: token.hex ?? "transparent" }],
    [styles.swatch, token.hex],
  );
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={props.chosen ? CHECKED : UNCHECKED}
      aria-checked={props.chosen}
      accessibilityLabel={token.name}
      onPress={press}
      style={props.chosen ? styles.colorChipSelected : styles.colorChip}
    >
      <View style={swatch} />
      <Text style={styles.chipLabel} numberOfLines={1}>
        {shortToken(token.name)}
      </Text>
    </Pressable>
  );
}

/** One tool's controls: a single row, so switching tools never moves the picture. */
function ToolPanel(props: {
  tool: Tool;
  layer: Layer;
  colors: ColorToken[];
  text: string;
  step: string;
  busy: boolean;
  styles: DesignStyles;
  onText(text: string): void;
  onStep(step: string): void;
  onApplyText(): void;
  onFill(token: string): void;
  onNudge(nudge: Nudge): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const { tool, layer, styles, busy } = props;
  if (tool === "text") {
    return (
      <>
        <TextInput
          accessibilityLabel="Text"
          value={props.text}
          onChangeText={props.onText}
          multiline
          maxLength={5000}
          style={styles.inputInline}
        />
        <TextButton
          label="Apply"
          primary
          disabled={busy || props.text === layer.text}
          styles={styles}
          onPress={props.onApplyText}
        />
      </>
    );
  }
  if (tool === "fill") {
    if (props.colors.length === 0) {
      return <Text style={styles.detail.muted}>This design has no colour tokens</Text>;
    }
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        accessibilityRole="radiogroup"
        accessibilityLabel="Fill"
      >
        {props.colors.map((token) => (
          <ColorChip
            key={token.name}
            token={token}
            chosen={token.name === layer.fill.token}
            styles={styles}
            onChoose={props.onFill}
          />
        ))}
      </ScrollView>
    );
  }
  if (tool === "layer") {
    return (
      <>
        <TextButton label="Duplicate" disabled={busy} styles={styles} onPress={props.onDuplicate} />
        <TextButton
          label="Delete"
          danger
          disabled={busy}
          styles={styles}
          onPress={props.onDelete}
        />
      </>
    );
  }
  return (
    <>
      {(tool === "move" ? MOVES : SIZES).map((entry) => (
        <NudgeButton
          key={entry.label}
          nudge={entry}
          step={Number(props.step)}
          disabled={busy}
          styles={styles}
          onNudge={props.onNudge}
        />
      ))}
      <View style={styles.inspectorSpacer} />
      <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Step">
        {STEPS.map((entry) => (
          <Chip
            key={entry.id}
            id={entry.id}
            label={entry.label}
            chosen={entry.id === props.step}
            styles={styles}
            onChoose={props.onStep}
          />
        ))}
      </View>
    </>
  );
}

/**
 * The picked layer's tools, under the picture so the layer stays in view while it changes: one
 * tool's controls at a time, in a block that keeps its height.
 */
export function LayerInspector(props: {
  fileId: string;
  editing: Editing;
  /** True once this view has made an edit, which turns Undo and Redo on. */
  edited: boolean;
  styles: DesignStyles;
  onUpdate(next: Editing): void;
  onEdited(): void;
  onClose(): void;
}) {
  const { fileId, editing, styles, onUpdate, onEdited } = props;
  const edit = useRpc(editRpc);
  const [tool, setTool] = useState<Tool>("text");
  const [step, setStep] = useState("1");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { layer, id } = editing;
  const shownText = layer?.text ?? null;
  useEffect(() => setText(shownText ?? ""), [layer?.id, shownText]);

  /** One edit at a time; a failure reads "Unable to <what>: ..." on the inspector's own line. */
  const run = useCallback(
    (what: string, action: EditAction, edits: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      void edit({ fileId, action })
        .then((result) => {
          if (!result.ok) throw new Error(result.error);
          onUpdate({ ...editing, id: result.layer?.id ?? id, layer: result.layer });
          if (edits) onEdited();
          return undefined;
        })
        .catch((failure: unknown) => {
          if (mounted.current) setError(failureText(what, failure));
        })
        .finally(() => {
          if (mounted.current) setBusy(false);
        });
    },
    [busy, edit, editing, fileId, id, onEdited, onUpdate],
  );
  const change = useCallback(
    (what: string, next: Change) => run(what, { type: "change", id, change: next }, true),
    [id, run],
  );
  const stepPx = Number(step);
  const nudge = useCallback(
    (which: Nudge) => change(which.label, which.change(stepPx)),
    [change, stepPx],
  );
  const applyText = useCallback(
    () => change("Change the text", { kind: "text", text }),
    [change, text],
  );
  const fill = useCallback(
    (token: string) => change("Set the fill", { kind: "fill", token }),
    [change],
  );
  const choose = useCallback(
    (next: string) => run("Pick the layer", { type: "layer", id: next }, false),
    [run],
  );
  const duplicate = useCallback(() => change("Duplicate", DUPLICATE), [change]);
  const remove = useCallback(() => change("Delete", DELETE), [change]);
  const undo = useCallback(() => run("Undo", { type: "undo", id }, true), [id, run]);
  const redo = useCallback(() => run("Redo", { type: "redo", id }, true), [id, run]);
  const chooseTool = useCallback((next: string) => setTool(next as Tool), []);

  const tools = layer?.text == null ? TOOLS.filter((entry) => entry.id !== "text") : TOOLS;
  const shown: Tool = tool === "text" && layer?.text == null ? "fill" : tool;
  // A tap on one layer lists nothing else; the layer still gets its name on a chip.
  const here = useMemo(
    () =>
      editing.here.length > 0 || layer === null
        ? editing.here
        : [{ id: layer.id, name: layer.name, type: layer.type }],
    [editing.here, layer],
  );

  return (
    <View style={styles.inspector} accessibilityLabel="Layer tools" testID="layer-tools">
      <View style={styles.inspectorHead}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.inspectorLayers}
          contentContainerStyle={styles.chipRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="Layers under the tap"
        >
          {here.map((ref) => (
            <Chip
              key={ref.id}
              id={ref.id}
              label={ref.name || typeLabel(ref.type)}
              chosen={ref.id === layer?.id}
              styles={styles}
              onChoose={choose}
            />
          ))}
        </ScrollView>
        <IconButton
          label="Undo"
          icon="Undo2"
          disabled={!props.edited || busy}
          styles={styles}
          onPress={undo}
        />
        <IconButton
          label="Redo"
          icon="Redo2"
          disabled={!props.edited || busy}
          styles={styles}
          onPress={redo}
        />
        <IconButton
          label="Close the layer's tools"
          icon="X"
          styles={styles}
          onPress={props.onClose}
        />
      </View>
      {error === null ? (
        <Text style={styles.detail.muted} numberOfLines={1}>
          {layer === null ? "Deleted. Undo brings it back" : facts(layer)}
        </Text>
      ) : (
        <Text accessibilityRole="alert" style={styles.detail.danger} numberOfLines={2}>
          {error}
        </Text>
      )}
      {layer === null ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.inspectorTools}
          contentContainerStyle={styles.chipRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="Tool"
        >
          {tools.map((entry) => (
            <Chip
              key={entry.id}
              id={entry.id}
              label={entry.label}
              chosen={entry.id === shown}
              styles={styles}
              onChoose={chooseTool}
            />
          ))}
        </ScrollView>
      )}
      <View style={styles.inspectorPanel}>
        {layer === null ? null : (
          <ToolPanel
            tool={shown}
            layer={layer}
            colors={editing.colors}
            text={text}
            step={step}
            busy={busy}
            styles={styles}
            onText={setText}
            onStep={setStep}
            onApplyText={applyText}
            onFill={fill}
            onNudge={nudge}
            onDuplicate={duplicate}
            onDelete={remove}
          />
        )}
      </View>
    </View>
  );
}
