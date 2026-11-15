import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import {
  connections,
  setTokenRpc,
  testConnectionRpc,
  tokensRpc,
  type Connections,
  type Source,
  type Tokens,
} from "../shared/contracts.js";
import { reason } from "./reason.js";
import { useScreenStyles } from "./styles.js";

type ConnectionsState = SettingsState<typeof connections.schema>;
type ReadySettings = Extract<ConnectionsState, { status: "ready" }>;

interface Field {
  key: keyof Connections;
  label: string;
  placeholder: string;
}

interface TrackerForm {
  source: Source;
  title: string;
  info: string;
  fields: readonly Field[];
  tokenLabel: string;
  tokenHint: string;
}

const WHERE = "They show in the Task field on New workspace and under Task in a composer's + menu.";

const JIRA: TrackerForm = {
  source: "jira",
  title: "Jira",
  info: `Lists your open Jira issues. ${WHERE}`,
  fields: [
    { key: "jiraSite", label: "Site", placeholder: "https://your-team.atlassian.net" },
    { key: "jiraEmail", label: "Email", placeholder: "you@example.com" },
  ],
  tokenLabel: "API token",
  tokenHint: "Made at id.atlassian.com under Security, API tokens",
};

const GITLAB: TrackerForm = {
  source: "gitlab",
  title: "GitLab",
  info: `Lists the open GitLab issues assigned to you. ${WHERE}`,
  fields: [{ key: "gitlabUrl", label: "Address", placeholder: "https://gitlab.example.com" }],
  tokenLabel: "Access token",
  tokenHint: "A personal access token with the read_api scope",
};

const TOKEN_KEPT = "Saved on the host. Type a new one to replace it";

/** What the last save or test of one tracker came to. */
type Outcome = { kind: "ok" | "error"; text: string } | null;

interface TrackerSectionProps {
  form: TrackerForm;
  settings: ReadySettings;
  hasToken: boolean;
  onTokens(tokens: Tokens): void;
}

function TrackerSection({ form, settings, hasToken, onTokens }: TrackerSectionProps) {
  const { source, fields } = form;
  const writeToken = useRpc(setTokenRpc);
  const testConnection = useRpc(testConnectionRpc);
  // The inputs own their text; this is what they last reported.
  const draft = useRef<Partial<Connections>>({});
  const token = useRef("");
  const tokenInput = useRef<SettingsInputHandle>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Outcome>(null);
  // The settings hook holds the reason; both sections read the same hook, so each remembers
  // whether the refusal was its own.
  const [refused, setRefused] = useState(false);
  const [tested, setTested] = useState<Outcome>(null);

  const changeToken = useCallback((text: string) => {
    token.current = text;
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setSaved(null);
    setRefused(false);
    setTested(null);
    try {
      const values = { ...settings.values, ...draft.current };
      if (!(await settings.save(values, settings.revision))) {
        setRefused(true);
        return;
      }
      if (token.current.trim() !== "") {
        onTokens(await writeToken({ source, token: token.current }));
        token.current = "";
        tokenInput.current?.replaceText("");
      }
      setSaved({ kind: "ok", text: "Saved" });
    } catch (error) {
      setSaved({ kind: "error", text: reason(error) });
    } finally {
      setBusy(false);
    }
  }, [onTokens, settings, source, writeToken]);

  const test = useCallback(async () => {
    setBusy(true);
    setTested(null);
    try {
      const { account } = await testConnection({ source });
      setTested({ kind: "ok", text: `Signed in as ${account}` });
    } catch (error) {
      setTested({ kind: "error", text: reason(error) });
    } finally {
      setBusy(false);
    }
  }, [source, testConnection]);

  const remove = useCallback(async () => {
    setBusy(true);
    setSaved(null);
    setTested(null);
    try {
      onTokens(await writeToken({ source, token: "" }));
      setSaved({ kind: "ok", text: "Token removed" });
    } catch (error) {
      setSaved({ kind: "error", text: reason(error) });
    } finally {
      setBusy(false);
    }
  }, [onTokens, source, writeToken]);

  const disabled = busy || settings.saving;
  let saveError: string | null | undefined;
  if (saved?.kind === "error") saveError = saved.text;
  else if (refused) saveError = settings.saveError;
  return (
    <SettingsSection title={form.title} info={form.info}>
      <SettingsCard>
        {fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            settings={settings}
            draft={draft}
            disabled={disabled}
          />
        ))}
        <SettingsInput
          ref={tokenInput}
          label={form.tokenLabel}
          hint={hasToken ? TOKEN_KEPT : form.tokenHint}
          onChangeText={changeToken}
          placeholder={hasToken ? "Saved" : "Paste the token"}
          disabled={disabled}
          secureTextEntry
        />
        <SettingsAction
          label={`Save the ${form.title} connection`}
          hint={saved?.kind === "ok" ? saved.text : undefined}
          error={saveError}
          actionLabel={busy ? "Working..." : "Save"}
          disabled={disabled}
          onPress={save}
        />
        <SettingsAction
          label="Test what is saved"
          hint={tested?.kind === "ok" ? tested.text : undefined}
          error={tested?.kind === "error" ? tested.text : undefined}
          actionLabel="Test"
          disabled={disabled}
          onPress={test}
        />
        {hasToken ? (
          <SettingsAction
            label={`Remove the ${form.title} token from the host`}
            actionLabel="Remove"
            disabled={disabled}
            onPress={remove}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

interface FieldInputProps {
  field: Field;
  settings: ReadySettings;
  draft: { current: Partial<Connections> };
  disabled: boolean;
}

function FieldInput({ field, settings, draft, disabled }: FieldInputProps) {
  const change = useCallback(
    (text: string) => {
      draft.current[field.key] = text;
    },
    [draft, field.key],
  );
  return (
    <SettingsInput
      label={field.label}
      initialValue={settings.values[field.key]}
      onChangeText={change}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
}

const NO_TOKENS: Tokens = { jira: { hasToken: false }, gitlab: { hasToken: false } };

function Trackers({
  settings,
  styles,
}: {
  settings: ReadySettings;
  styles: ReturnType<typeof useScreenStyles>;
}) {
  const readTokens = useRpc(tokensRpc);
  const [tokens, setTokens] = useState<Tokens>(NO_TOKENS);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const state = await readTokens({});
        if (live) setTokens(state);
      } catch (failure) {
        if (live) setError(reason(failure));
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [readTokens]);
  return (
    <>
      {error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <TrackerSection
        form={JIRA}
        settings={settings}
        hasToken={tokens.jira.hasToken}
        onTokens={setTokens}
      />
      <TrackerSection
        form={GITLAB}
        settings={settings}
        hasToken={tokens.gitlab.hasToken}
        onTokens={setTokens}
      />
    </>
  );
}

/** Where the trackers are and the tokens that sign in to them. */
export function ConnectionsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(connections);
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading the task connections...</Text>;
  }
  if (settings.status === "ready") return <Trackers settings={settings} styles={styles} />;
  return (
    <SettingsSection title="Task connections">
      <Text accessibilityRole="alert" style={styles.error}>
        {settings.error}
      </Text>
      <SettingsCard>
        <SettingsAction
          label="Read the connections again"
          actionLabel="Reload"
          onPress={settings.reload}
        />
        {settings.status === "invalid" ? (
          <SettingsAction
            label="Start with no connections"
            hint="Replaces the stored addresses, which cannot be read. Saved tokens stay"
            error={settings.saveError}
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={settings.reset}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
