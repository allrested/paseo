import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  editRpc,
  type Change,
  type ColorToken,
  type EditAction,
  type Layer,
  type LayerRef,
} from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { Chip } from "./controls.js";
import type { DesignStyles } from "./styles.js";

/** What the sheet works on. `id` stays after a delete, so Undo can bring the layer back. */
export interface Editing {
  id: string;
  layer: Layer | null;
  here: LayerRef[];
  colors: ColorToken[];
}

interface Nudge {
  label: string;
  change: Change;
}

function moves(n: number): Nudge[] {
  return [
    { label: "Left", change: { kind: "move", dx: -n, dy: 0 } },
    { label: "Right", change: { kind: "move", dx: n, dy: 0 } },
    { label: "Up", change: { kind: "move", dx: 0, dy: -n } },
    { label: "Down", change: { kind: "move", dx: 0, dy: n } },
  ];
}

function sizes(n: number): Nudge[] {
  return [
    { label: "Narrower", change: { kind: "resize", dw: -n, dh: 0 } },
    { label: "Wider", change: { kind: "resize", dw: n, dh: 0 } },
    { label: "Shorter", change: { kind: "resize", dw: 0, dh: -n } },
    { label: "Taller", change: { kind: "resize", dw: 0, dh: n } },
  ];
}

const STEPS: Record<string, { label: string; moves: Nudge[]; sizes: Nudge[] }> = {
  "1": { label: "1 px", moves: moves(1), sizes: sizes(1) },
  "10": { label: "10 px", moves: moves(10), sizes: sizes(10) },
};
const DUPLICATE: Change = { kind: "duplicate" };
const DELETE: Change = { kind: "delete" };
const CHECKED = { checked: true };
const UNCHECKED = { checked: false };

/** FigCraft's layer type in words: "ROUNDED_RECTANGLE" reads "Rounded rectangle". */
export function typeLabel(type: string): string {
  const words = type.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Its failure goes to the sheet's error line, worded by `verb` ("Unable to resize the layer"). */
function ChangeButton(props: {
  label: string;
  verb: string;
  change: Change;
  styles: DesignStyles;
  onChange(change: Change): Promise<void>;
  onError(message: string): void;
}) {
  const { change, onChange, onError, verb } = props;
  const press = useCallback(
    () => onChange(change).catch((failure: unknown) => onError(failureText(verb, failure))),
    [change, onChange, onError, verb],
  );
  return (
    <ActionButton
      label={props.label}
      pendingLabel={props.label}
      styles={props.styles}
      onPress={press}
    />
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
      accessibilityLabel={token.name}
      onPress={press}
      style={props.chosen ? styles.colorChipSelected : styles.colorChip}
    >
      <View style={swatch} />
      <Text style={styles.chipLabel} numberOfLines={1}>
        {token.name}
      </Text>
    </Pressable>
  );
}

function fillText(layer: Layer): string {
  return layer.fill.token ?? layer.fill.color ?? "None";
}

/** The layer picked on the phone: its text, fill token, place and size, with undo. */
export function LayerSheet(props: {
  fileId: string;
  editing: Editing | null;
  /** True once this view has made an edit, which turns Undo and Redo on. */
  edited: boolean;
  styles: DesignStyles;
  onUpdate(next: Editing): void;
  onEdited(): void;
  onClose(): void;
}) {
  const { fileId, editing, styles, onUpdate, onEdited, onClose } = props;
  const edit = useRpc(editRpc);
  const [step, setStep] = useState("1");
  const [text, setText] = useState("");
  /** A chip's failure; buttons show their own. */
  const [error, setError] = useState<string | null>(null);
  const layer = editing?.layer ?? null;
  const shownText = layer?.text ?? null;
  useEffect(() => setText(shownText ?? ""), [layer?.id, shownText]);

  const run = useCallback(
    async (action: EditAction, edits: boolean) => {
      if (editing === null) return;
      setError(null);
      const result = await edit({ fileId, action });
      if (!result.ok) throw new Error(result.error);
      onUpdate({ ...editing, id: result.layer?.id ?? editing.id, layer: result.layer });
      if (edits) onEdited();
    },
    [edit, editing, fileId, onEdited, onUpdate],
  );
  const id = editing?.id ?? "";
  const change = useCallback(
    (next: Change) => run({ type: "change", id, change: next }, true),
    [id, run],
  );
  const applyText = useCallback(() => change({ kind: "text", text }), [change, text]);
  const fill = useCallback(
    (token: string) =>
      void change({ kind: "fill", token }).catch((failure: unknown) =>
        setError(failureText("Set the fill", failure)),
      ),
    [change],
  );
  const choose = useCallback(
    (next: string) =>
      void run({ type: "layer", id: next }, false).catch((failure: unknown) =>
        setError(failureText("Pick the layer", failure)),
      ),
    [run],
  );
  const undo = useCallback(() => run({ type: "undo", id }, true), [id, run]);
  const redo = useCallback(() => run({ type: "redo", id }, true), [id, run]);
  const openChange = useCallback((open: boolean) => !open && onClose(), [onClose]);
  const steps = STEPS[step] ?? STEPS["1"]!;

  return (
    <Modal title="Edit layer" open={editing !== null} onOpenChange={openChange}>
      <Modal.Content>
        <View style={styles.sheet}>
          {layer === null ? (
            <Text style={styles.sheetText}>Deleted. Undo brings it back</Text>
          ) : (
            <View>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {layer.name}
              </Text>
              <Text style={styles.detail.muted}>
                {`${typeLabel(layer.type)} · ${Math.round(layer.width)} × ${Math.round(layer.height)} · Fill ${fillText(layer)}`}
              </Text>
            </View>
          )}
          {editing !== null && editing.here.length > 1 ? (
            <View style={styles.sheet}>
              <Text style={styles.sheetLabel}>Layers here</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {editing.here.map((ref) => (
                  <Chip
                    key={ref.id}
                    id={ref.id}
                    label={ref.name || typeLabel(ref.type)}
                    chosen={ref.id === editing.id}
                    styles={styles}
                    onChoose={choose}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {layer !== null && layer.text !== null ? (
            <View style={styles.sheet}>
              <TextInput
                accessibilityLabel="Text"
                value={text}
                onChangeText={setText}
                multiline
                maxLength={5000}
                style={styles.input}
              />
              <View style={styles.sheetActions}>
                <ActionButton
                  label="Apply text"
                  pendingLabel="Applying..."
                  primary
                  disabled={text === layer.text}
                  styles={styles}
                  onPress={applyText}
                />
              </View>
            </View>
          ) : null}
          {layer !== null && editing !== null && editing.colors.length > 0 ? (
            <View style={styles.sheet}>
              <Text style={styles.sheetLabel}>Fill</Text>
              <ScrollView style={styles.colorList}>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {editing.colors.map((token) => (
                    <ColorChip
                      key={token.name}
                      token={token}
                      chosen={token.name === layer.fill.token}
                      styles={styles}
                      onChoose={fill}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}
          {layer === null ? null : (
            <View style={styles.sheet}>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {Object.entries(STEPS).map(([key, value]) => (
                  <Chip
                    key={key}
                    id={key}
                    label={value.label}
                    chosen={key === step}
                    styles={styles}
                    onChoose={setStep}
                  />
                ))}
              </View>
              <Text style={styles.sheetLabel}>Move</Text>
              <View style={styles.chips}>
                {steps.moves.map((nudge) => (
                  <ChangeButton
                    key={nudge.label}
                    label={nudge.label}
                    verb="Move the layer"
                    change={nudge.change}
                    styles={styles}
                    onChange={change}
                    onError={setError}
                  />
                ))}
              </View>
              <Text style={styles.sheetLabel}>Size</Text>
              <View style={styles.chips}>
                {steps.sizes.map((nudge) => (
                  <ChangeButton
                    key={nudge.label}
                    label={nudge.label}
                    verb="Resize the layer"
                    change={nudge.change}
                    styles={styles}
                    onChange={change}
                    onError={setError}
                  />
                ))}
              </View>
            </View>
          )}
          {error === null ? null : (
            <Text accessibilityRole="alert" style={styles.actionError}>
              {error}
            </Text>
          )}
          <View style={styles.sheetActionsSplit}>
            <View style={styles.chips}>
              <ActionButton
                label="Undo"
                pendingLabel="Undo"
                disabled={!props.edited}
                styles={styles}
                onPress={undo}
              />
              <ActionButton
                label="Redo"
                pendingLabel="Redo"
                disabled={!props.edited}
                styles={styles}
                onPress={redo}
              />
            </View>
            {layer === null ? null : (
              <View style={styles.chips}>
                <ChangeButton
                  label="Duplicate"
                  verb="Duplicate"
                  change={DUPLICATE}
                  styles={styles}
                  onChange={change}
                  onError={setError}
                />
                <ChangeButton
                  label="Delete"
                  verb="Delete"
                  change={DELETE}
                  styles={styles}
                  onChange={change}
                  onError={setError}
                />
              </View>
            )}
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
