import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { sharedMcpSettings } from "../shared/settings.js";
import { formatDefinitions, parseDefinitions } from "./definitions.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

type ReadySettings = Extract<SettingsState<typeof sharedMcpSettings.schema>, { status: "ready" }>;

const EDITOR_INFO =
  "A JSON array of server definitions. Saving starts, restarts, or stops servers to match.";
const STALE_HINT = "The saved definitions changed after you started editing. Discard to load them.";
const RESET_HINT = "Replaces the stored file with an empty server list, which stops every server.";

interface Draft {
  text: string;
  /** The revision the edit started from, so saving over another client's save is a conflict. */
  revision: string;
}

interface DefinitionsEditorProps {
  settings: ReadySettings;
  styles: ScreenStyles;
}

function DefinitionsEditor({ settings, styles }: DefinitionsEditorProps) {
  // No draft means the editor shows the saved definitions and follows other clients' saves.
  const [draft, setDraft] = useState<Draft | null>(null);
  const { revision } = settings;
  const text = draft?.text ?? formatDefinitions(settings.values.servers);
  const parsed = useMemo(() => parseDefinitions(text), [text]);
  const changeText = useCallback(
    (next: string) =>
      setDraft((current) => ({ text: next, revision: current?.revision ?? revision })),
    [revision],
  );
  const save = useCallback(async () => {
    if (draft === null || !parsed.ok) return;
    if (await settings.save(parsed.values, draft.revision)) setDraft(null);
  }, [draft, parsed, settings]);
  const discard = useCallback(() => {
    setDraft(null);
    void settings.reload();
  }, [settings]);
  const stale = draft !== null && draft.revision !== revision;
  const canSave = draft !== null && parsed.ok && !settings.saving;
  const canDiscard = draft !== null && !settings.saving;
  return (
    <SettingsSection title="Server definitions" info={EDITOR_INFO}>
      <SettingsCard>
        <View style={styles.block}>
          <TextInput
            multiline
            value={text}
            onChangeText={changeText}
            editable={!settings.saving}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Server definitions as JSON"
            style={styles.editor}
          />
          {parsed.ok ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {parsed.error}
            </Text>
          )}
        </View>
        <SettingsAction
          label="Save definitions"
          hint={stale ? STALE_HINT : undefined}
          error={settings.saveError}
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={!canSave}
          onPress={save}
        />
        <SettingsAction
          label="Discard changes"
          actionLabel="Discard"
          disabled={!canDiscard}
          onPress={discard}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function DefinitionsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(sharedMcpSettings);
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading definitions…</Text>;
  }
  if (settings.status === "ready") return <DefinitionsEditor settings={settings} styles={styles} />;
  return (
    <SettingsSection title="Server definitions">
      <Text accessibilityRole="alert" style={styles.error}>
        {settings.error}
      </Text>
      <SettingsAction
        label="Read the saved definitions again"
        actionLabel="Reload"
        onPress={settings.reload}
      />
      {settings.status === "invalid" ? (
        <SettingsAction
          label="Restore defaults"
          hint={RESET_HINT}
          error={settings.saveError}
          actionLabel="Reset"
          disabled={settings.saving}
          onPress={settings.reset}
        />
      ) : null}
    </SettingsSection>
  );
}
