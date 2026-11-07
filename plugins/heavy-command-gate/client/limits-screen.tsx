import { useCallback, useEffect, useMemo, useState } from "react";
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
import { parseDraft, toDraft, type SettingsDraft } from "./settings-form.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

type GateSettingsState = SettingsState<typeof gateSettings.schema>;
type ReadySettings = Extract<GateSettingsState, { status: "ready" }>;
type ResettableSettings = Extract<GateSettingsState, { status: "ready" | "invalid" }>;

const LIMITS_INFO =
  "A heavy command starts when a slot is free and free memory covers its estimate plus the reserve.";
const PATTERNS_INFO =
  "One command per line: its estimate in GB, a space, then the words the command starts with. Write each as npm runs it: tsc matches npx tsc, and npm run build matches pnpm build. Lines starting with # are skipped. The longest match wins.";
const STALE_HINT = "The saved settings changed after you started editing. Discard to load them.";
const RESET_HINT =
  "Puts back the defaults: the gate on, one slot, a 1 GB reserve and the default heavy commands";
const RESET_CONFIRM_MS = 5_000;
const RESET_CONFIRM_HINT = `Press again within ${RESET_CONFIRM_MS / 1000} s to replace every limit and heavy command with the defaults`;

interface Draft extends SettingsDraft {
  /** The revision the edit started from, so saving over another client's save is a conflict. */
  revision: string;
}

interface ResetActionProps {
  settings: ResettableSettings;
  onReset(): void;
}

interface LimitsEditorProps {
  settings: ReadySettings;
  styles: ScreenStyles;
}

function ResetAction({ settings, onReset }: ResetActionProps) {
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
  return (
    <SettingsAction
      label="Restore defaults"
      hint={armed ? RESET_CONFIRM_HINT : RESET_HINT}
      error={settings.saveError}
      actionLabel={armed ? "Confirm reset" : "Reset"}
      disabled={settings.saving}
      onPress={press}
    />
  );
}

function LimitsEditor({ settings, styles }: LimitsEditorProps) {
  // No draft means the fields show the saved settings and follow other clients' saves.
  const [draft, setDraft] = useState<Draft | null>(null);
  // Bumped by Discard and Reset, so the uncontrolled inputs remount with the saved values.
  const [generation, setGeneration] = useState(0);
  const { revision, values } = settings;
  const saved = useMemo(() => toDraft(values), [values]);
  const shown: SettingsDraft = draft ?? saved;
  const parsed = useMemo(() => parseDraft(shown, values.enabled), [shown, values.enabled]);
  const update = useCallback(
    (patch: Partial<SettingsDraft>) => {
      setDraft((current) => ({ ...(current ?? { ...saved, revision }), ...patch }));
    },
    [saved, revision],
  );
  const changeSlots = useCallback((text: string) => update({ slots: text }), [update]);
  const changeReserve = useCallback((text: string) => update({ reserveGb: text }), [update]);
  const changePatterns = useCallback((text: string) => update({ patterns: text }), [update]);
  const save = useCallback(async () => {
    if (draft === null || !parsed.ok) return;
    if (await settings.save(parsed.values, draft.revision)) setDraft(null);
  }, [draft, parsed, settings]);
  const clearDraft = useCallback(() => {
    setDraft(null);
    setGeneration((current) => current + 1);
  }, []);
  const discard = useCallback(() => {
    clearDraft();
    void settings.reload();
  }, [clearDraft, settings]);
  const errors = parsed.ok ? null : parsed.errors;
  const stale = draft !== null && draft.revision !== revision;
  const canSave = draft !== null && parsed.ok && !settings.saving;
  const canDiscard = draft !== null && !settings.saving;
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
            error={settings.saveError}
            actionLabel={settings.saving ? "Saving..." : "Save"}
            disabled={!canSave}
            onPress={save}
          />
          <SettingsAction
            label="Discard changes"
            actionLabel="Discard"
            disabled={!canDiscard}
            onPress={discard}
          />
          <ResetAction settings={settings} onReset={clearDraft} />
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
  return (
    <SettingsSection title="Limits">
      <Text accessibilityRole="alert" style={styles.error}>
        {settings.error}
      </Text>
      <SettingsAction
        label="Read the saved settings again"
        actionLabel="Reload"
        onPress={settings.reload}
      />
      {settings.status === "invalid" ? <ResetAction settings={settings} onReset={noop} /> : null}
    </SettingsSection>
  );
}
