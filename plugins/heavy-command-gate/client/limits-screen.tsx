import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { gateSettings } from "../shared/settings.js";
import {
  INITIAL_EDITOR_STATE,
  editorReducer,
  parseDraft,
  resetRow,
  saveRow,
  toDraft,
  type RequestKind,
  type SettingsDraft,
} from "./settings-form.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

type GateSettingsState = SettingsState<typeof gateSettings.schema>;
type ReadySettings = Extract<GateSettingsState, { status: "ready" }>;
type ResettableSettings = Extract<GateSettingsState, { status: "ready" | "invalid" }>;
type FailedSettings = Extract<GateSettingsState, { status: "error" | "invalid" }>;

const LIMITS_INFO =
  "A heavy command starts when a slot is free and free memory covers its estimate plus the reserve.";
const PATTERNS_INFO =
  "One command per line: its estimate in GB, a space, then the words the command starts with. Write each as npm runs it: tsc matches npx tsc, and npm run build matches pnpm build. Lines starting with # are skipped. The longest match wins.";
const STALE_HINT = "The saved settings changed after you started editing. Discard to load them.";
const RESET_HINT =
  "Puts back the defaults: the gate on, one slot, a 1 GB reserve and the default heavy commands";
const RESET_CONFIRM_MS = 5_000;
const RESET_CONFIRM_HINT = `Press again within ${RESET_CONFIRM_MS / 1000} s to turn the gate on and replace every limit and heavy command with the defaults`;

interface ResetActionProps {
  settings: ResettableSettings;
  /** The request that `settings.saving` and `settings.saveError` describe. */
  lastRequest: RequestKind | null;
  onReset(): void;
}

interface ReloadActionProps {
  settings: FailedSettings;
}

interface LimitsEditorProps {
  settings: ReadySettings;
  styles: ScreenStyles;
}

function ResetAction({ settings, lastRequest, onReset }: ResetActionProps) {
  // The first press arms the reset; the timer, an unmount, or the reset itself disarms it.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const press = useCallback(() => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onReset();
    void settings.reset();
  }, [armed, settings, onReset]);
  const row = resetRow(lastRequest, settings, armed);
  return (
    <SettingsAction
      label="Restore defaults"
      hint={armed ? RESET_CONFIRM_HINT : RESET_HINT}
      error={row.error}
      actionLabel={row.actionLabel}
      disabled={settings.saving}
      onPress={press}
    />
  );
}

function ReloadAction({ settings }: ReloadActionProps) {
  // useSettings exposes no fetching flag, so the row keeps its own around the reload.
  const [reloading, setReloading] = useState(false);
  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await settings.reload();
    } finally {
      setReloading(false);
    }
  }, [settings]);
  // A reload also waits for a save or reset: it clears the request state, which would re-enable
  // Restore defaults while that request runs.
  return (
    <SettingsAction
      label="Read the saved settings again"
      actionLabel={reloading ? "Reloading..." : "Reload"}
      disabled={reloading || settings.saving}
      onPress={reload}
    />
  );
}

function LimitsEditor({ settings, styles }: LimitsEditorProps) {
  const [{ draft, generation, lastRequest }, dispatch] = useReducer(
    editorReducer,
    INITIAL_EDITOR_STATE,
  );
  const { revision, values } = settings;
  const saved = useMemo(() => toDraft(values), [values]);
  const shown: SettingsDraft = draft ?? saved;
  const parsed = useMemo(() => parseDraft(shown, values.enabled), [shown, values.enabled]);
  const update = useCallback(
    (patch: Partial<SettingsDraft>) => dispatch({ type: "edit", patch, saved, revision }),
    [saved, revision],
  );
  const changeSlots = useCallback((text: string) => update({ slots: text }), [update]);
  const changeReserve = useCallback((text: string) => update({ reserveGb: text }), [update]);
  const changePatterns = useCallback((text: string) => update({ patterns: text }), [update]);
  const save = useCallback(async () => {
    if (draft === null || !parsed.ok) return;
    dispatch({ type: "save-started" });
    if (await settings.save(parsed.values, draft.revision)) dispatch({ type: "save-succeeded" });
  }, [draft, parsed, settings]);
  const discard = useCallback(() => {
    dispatch({ type: "discard" });
    void settings.reload();
  }, [settings]);
  const startReset = useCallback(() => dispatch({ type: "reset-started" }), []);
  const errors = parsed.ok ? null : parsed.errors;
  const stale = draft !== null && draft.revision !== revision && !settings.saving;
  const canSave = draft !== null && parsed.ok && !settings.saving;
  const canDiscard = draft !== null && !settings.saving;
  const saveAction = saveRow(lastRequest, settings);
  const inputKey = `${generation}:${draft?.revision ?? revision}`;
  return (
    <>
      <SettingsSection title="Limits" info={LIMITS_INFO}>
        <SettingsCard>
          <SettingsInput
            key={`slots:${inputKey}`}
            label="Slots"
            hint="How many heavy commands run at once"
            initialValue={shown.slots}
            error={errors?.slots}
            disabled={settings.saving}
            onChangeText={changeSlots}
          />
          <SettingsInput
            key={`reserve:${inputKey}`}
            label="Reserve in GB"
            hint="Memory kept free beside each command's estimate"
            initialValue={shown.reserveGb}
            error={errors?.reserveGb}
            disabled={settings.saving}
            onChangeText={changeReserve}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Heavy commands" info={PATTERNS_INFO}>
        <SettingsCard>
          <View style={styles.block}>
            <TextInput
              multiline
              value={shown.patterns}
              onChangeText={changePatterns}
              editable={!settings.saving}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              accessibilityLabel="Heavy commands, one per line"
              style={styles.editor}
            />
            {errors?.patterns ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errors.patterns}
              </Text>
            ) : null}
          </View>
          <SettingsAction
            label="Save settings"
            hint={stale ? STALE_HINT : undefined}
            error={saveAction.error}
            actionLabel={saveAction.actionLabel}
            disabled={!canSave}
            onPress={save}
          />
          <SettingsAction
            label="Discard changes"
            actionLabel="Discard"
            disabled={!canDiscard}
            onPress={discard}
          />
          <ResetAction settings={settings} lastRequest={lastRequest} onReset={startReset} />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function noop(): void {}

export function LimitsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(gateSettings);
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading settings...</Text>;
  }
  if (settings.status === "ready") return <LimitsEditor settings={settings} styles={styles} />;
  // Restore defaults is the only request this view starts, so the shared request state is its own.
  return (
    <SettingsSection title="Limits">
      <SettingsCard>
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {settings.error}
          </Text>
        </View>
        <ReloadAction settings={settings} />
        {settings.status === "invalid" ? (
          <ResetAction settings={settings} lastRequest="reset" onReset={noop} />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
