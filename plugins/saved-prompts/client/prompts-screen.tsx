import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { preview } from "../shared/prompts.js";
import { MAX_PROMPTS, savedPromptsSettings, type Prompt } from "../shared/settings.js";
import { applyEdit, removePrompt, type Edit } from "./edit.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

type PromptsState = SettingsState<typeof savedPromptsSettings.schema>;
type ReadySettings = Extract<PromptsState, { status: "ready" }>;
type InvalidSettings = Extract<PromptsState, { status: "invalid" }>;

const INFO =
  "Pick one from Prompts in the composer, or type /prompt and the start of its name. The prompt goes into the composer; you send it.";
const FROM_COMPOSER = "You can also name the composer's text from its Prompts list";
// The plugin SDK has no confirm dialog, so a removal asks for a second press within this window.
const CONFIRM_MS = 5_000;
const CONFIRM_HINT = `Press again within ${CONFIRM_MS / 1000} s`;

/** The first press arms; the second, within the window, is the yes. */
function useConfirm(): { armed: boolean; press(): boolean } {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const press = useCallback(() => {
    setArmed(!armed);
    return armed;
  }, [armed]);
  return { armed, press };
}

interface PromptRowProps {
  prompt: Prompt;
  disabled: boolean;
  onOpen(prompt: Prompt): void;
}

function PromptRow({ prompt, disabled, onOpen }: PromptRowProps) {
  const open = useCallback(() => onOpen(prompt), [onOpen, prompt]);
  return (
    <SettingsAction
      label={prompt.name}
      hint={preview(prompt.text)}
      actionLabel="Edit"
      disabled={disabled}
      onPress={open}
    />
  );
}

interface PromptEditorProps {
  settings: ReadySettings;
  edit: Edit;
  styles: ScreenStyles;
  onChange(edit: Edit): void;
  onClose(): void;
}

function PromptEditor({ settings, edit, styles, onChange, onClose }: PromptEditorProps) {
  const { prompts } = settings.values;
  const { original } = edit;
  const applied = applyEdit(prompts, edit);
  const confirm = useConfirm();
  const changeName = useCallback((name: string) => onChange({ ...edit, name }), [edit, onChange]);
  const changeText = useCallback((text: string) => onChange({ ...edit, text }), [edit, onChange]);
  const save = useCallback(async () => {
    if (!applied.ok) return;
    if (await settings.save(applied.values, settings.revision)) onClose();
  }, [applied, onClose, settings]);
  const remove = useCallback(async () => {
    if (original === null || !confirm.press()) return;
    if (await settings.save(removePrompt(prompts, original), settings.revision)) onClose();
  }, [confirm, onClose, original, prompts, settings]);
  return (
    <>
      <SettingsInput
        label="Name"
        hint="What you pick it by, and what you type after /prompt"
        initialValue={edit.name}
        onChangeText={changeName}
        placeholder="review"
        disabled={settings.saving}
      />
      <View style={styles.block}>
        <Text style={styles.label}>Prompt</Text>
        <TextInput
          multiline
          value={edit.text}
          onChangeText={changeText}
          editable={!settings.saving}
          accessibilityLabel="Prompt text"
          style={styles.editor}
        />
      </View>
      <SettingsAction
        label={original === null ? "Add this prompt" : "Save changes"}
        hint={applied.ok ? undefined : applied.error}
        error={settings.saveError}
        actionLabel={settings.saving ? "Saving..." : "Save"}
        disabled={!applied.ok || settings.saving}
        onPress={save}
      />
      <SettingsAction
        label="Discard changes"
        actionLabel="Discard"
        disabled={settings.saving}
        onPress={onClose}
      />
      {original === null ? null : (
        <SettingsAction
          label="Delete this prompt"
          hint={confirm.armed ? `${CONFIRM_HINT} to delete "${original}"` : undefined}
          actionLabel={confirm.armed ? "Confirm delete" : "Delete"}
          disabled={settings.saving}
          onPress={remove}
        />
      )}
    </>
  );
}

function newPromptHint(count: number): string {
  if (count >= MAX_PROMPTS) return `The list holds at most ${MAX_PROMPTS} prompts`;
  return count === 0 ? `Nothing saved yet. ${FROM_COMPOSER}` : FROM_COMPOSER;
}

function PromptList({ settings, styles }: { settings: ReadySettings; styles: ScreenStyles }) {
  // One prompt is open at a time; the others wait, so two edits never race for one save.
  const [edit, setEdit] = useState<Edit | null>(null);
  const { prompts } = settings.values;
  const open = useCallback(
    (prompt: Prompt) => setEdit({ original: prompt.name, name: prompt.name, text: prompt.text }),
    [],
  );
  const add = useCallback(() => setEdit({ original: null, name: "", text: "" }), []);
  const close = useCallback(() => setEdit(null), []);
  const editor =
    edit === null ? null : (
      <PromptEditor
        key={edit.original ?? ""}
        settings={settings}
        edit={edit}
        styles={styles}
        onChange={setEdit}
        onClose={close}
      />
    );
  // An open prompt another device removed has no row left to stand in, so it shows last.
  const inPlace = edit !== null && prompts.some((prompt) => prompt.name === edit.original);
  return (
    <SettingsSection title="Saved prompts" info={INFO}>
      <SettingsCard>
        {prompts.map((prompt) =>
          edit?.original === prompt.name ? (
            <View key={prompt.name}>{editor}</View>
          ) : (
            <PromptRow
              key={prompt.name}
              prompt={prompt}
              disabled={edit !== null || settings.saving}
              onOpen={open}
            />
          ),
        )}
        {edit === null || inPlace ? (
          <SettingsAction
            label="New prompt"
            hint={newPromptHint(prompts.length)}
            actionLabel="Add"
            disabled={edit !== null || settings.saving || prompts.length >= MAX_PROMPTS}
            onPress={add}
          />
        ) : (
          editor
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function ResetAction({ settings }: { settings: InvalidSettings }) {
  const confirm = useConfirm();
  const press = useCallback(() => {
    if (confirm.press()) void settings.reset();
  }, [confirm, settings]);
  return (
    <SettingsAction
      label="Start an empty list"
      hint={
        confirm.armed
          ? `${CONFIRM_HINT} to delete every saved prompt`
          : "Replaces the stored file, which cannot be read, with an empty list"
      }
      error={settings.saveError}
      actionLabel={confirm.armed ? "Confirm reset" : "Reset"}
      disabled={settings.saving}
      onPress={press}
    />
  );
}

export function PromptsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(savedPromptsSettings);
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading the saved prompts...</Text>;
  }
  if (settings.status === "ready") return <PromptList settings={settings} styles={styles} />;
  return (
    <SettingsSection title="Saved prompts">
      <Text accessibilityRole="alert" style={styles.error}>
        {settings.error}
      </Text>
      <SettingsCard>
        <SettingsAction
          label="Read the saved prompts again"
          actionLabel="Reload"
          onPress={settings.reload}
        />
        {settings.status === "invalid" ? <ResetAction settings={settings} /> : null}
      </SettingsCard>
    </SettingsSection>
  );
}
