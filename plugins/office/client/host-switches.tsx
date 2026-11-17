import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import type { IncidentsState, WakeState } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import { failureText } from "./action-button.js";
import { wakeSummary } from "./board-text.js";
import { LabeledSwitch } from "./labeled-switch.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

type HostSettings = SettingsState<typeof officeHostSettings.schema>;
type HostValues = Extract<HostSettings, { status: "ready" }>["values"];
/** A host setting, as its control is labelled. */
type HostSetting =
  | "Agent tools"
  | "Notes folder"
  | "Time zone"
  | "Jira projects"
  | "Sentry organisation"
  | "Sentry projects"
  | "Sentry address";

/** What the incidents fields need to know from the host: never a token's value. */
type TrackerState = Pick<IncidentsState, "jiraReady" | "sentryReady" | "scheduleError">;

const JIRA_UNSET =
  "ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL or ATLASSIAN_API_TOKEN is not set on this host";
const SENTRY_UNSET = "SENTRY_AUTH_TOKEN is not set on this host";

/** The line under a tracker's field: `missing` while the field is set, nothing while it is empty. */
function unsetLine(value: string | null, missing: string | null): string | null {
  return value !== null && value.trim() !== "" ? missing : null;
}

const DEFAULTS: HostValues = officeHostSettings.schema.parse({});

/**
 * The settings as the host holds them. A document that is not valid shows the defaults ("Agent
 * tools" on, as the host itself reads it), and a change overwrites it; null while it is read or
 * cannot be read.
 */
function storedValues(settings: HostSettings): HostValues | null {
  if (settings.status === "ready") return settings.values;
  return settings.status === "invalid" ? DEFAULTS : null;
}

export interface HostSwitchesProps {
  /** Null until the office has loaded and while its data is frozen: the switch is then not usable. */
  wake: WakeState | null;
  actions: BoardActions;
  styles: OfficeStyles;
  /** A failure of the device's own switch, shown under the row with the host's. */
  deviceProblem: string | null;
  /** Why the daemon's 8:00 schedule could not follow the notes settings: under the Time zone field. */
  scheduleError: string | null;
  /** Absent until the office's server has read the incidents: no field then says a variable is unset. */
  incidents: TrackerState | undefined;
  /** The device's own switch: last in the row, so on a phone it wraps to the line above the view. */
  children?: ReactNode;
}

/**
 * The header's switches. Host-wide: "Wake agents" pauses every wake, and "Agent tools" adds the
 * board tools to sessions opened from then on. Each follows the tap at once and goes back if the
 * host refuses it, with the reason on a line under the row. Under them, the stand-up notes'
 * folder and time zone, then the trackers the incidents check reads.
 */
export function HostSwitches({
  wake,
  actions,
  styles,
  deviceProblem,
  scheduleError,
  incidents,
  children,
}: HostSwitchesProps) {
  const settings = useSettings(officeHostSettings);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The tap, until the host has answered it.
  const [wantedWakes, setWantedWakes] = useState<boolean | null>(null);
  const [wakeProblem, setWakeProblem] = useState<string | null>(null);
  const toggleWakes = useCallback(
    (next: boolean) => {
      setWantedWakes(next);
      setWakeProblem(null);
      actions
        .setWakesPaused(!next)
        .catch((failure: unknown) => {
          const label = next ? "Turn Wake agents on" : "Turn Wake agents off";
          if (mounted.current) setWakeProblem(failureText(label, failure));
        })
        .finally(() => {
          if (mounted.current) setWantedWakes(null);
        });
    },
    [actions],
  );
  const stored = storedValues(settings);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save, saveError } = settings;
  // The setting the last save changed: its failure shows by its control.
  const [lastChange, setLastChange] = useState<HostSetting>("Agent tools");
  const change = useCallback(
    (setting: HostSetting, patch: Partial<HostValues>): Promise<boolean> => {
      if (stored === null || revision === null) return Promise.resolve(false);
      setLastChange(setting);
      // Never rejects: a refused save leaves its reason in saveError.
      return save({ ...stored, ...patch }, revision);
    },
    [save, stored, revision],
  );
  const [wantedTools, setWantedTools] = useState<boolean | null>(null);
  const toggleTools = useCallback(
    (next: boolean) => {
      if (revision === null) return;
      setWantedTools(next);
      void change("Agent tools", { agentTools: next }).finally(() => {
        if (mounted.current) setWantedTools(null);
      });
    },
    [change, revision],
  );
  const saveFolder = useCallback(
    (next: string) => change("Notes folder", { notesFolder: next }),
    [change],
  );
  const saveTimeZone = useCallback(
    (next: string) => change("Time zone", { notesTimeZone: next }),
    [change],
  );
  const saveProblem = useCallback(
    (setting: HostSetting): string | null =>
      saveError !== null && lastChange === setting
        ? failureText(`Save the ${setting} setting`, saveError)
        : null,
    [saveError, lastChange],
  );
  // A refused save of the zone comes first: the schedule then still follows the earlier one.
  const timeZoneProblem =
    saveProblem("Time zone") ??
    (scheduleError === null ? null : failureText("Schedule the stand-up notes", scheduleError));
  const summary = wake === null ? null : wakeSummary(wake);
  const wakesOn = wake === null ? null : !wake.paused;
  const problems = [
    wakeProblem,
    settings.status === "error" ? failureText("Read the office settings", settings.error) : null,
    saveProblem("Agent tools"),
    deviceProblem,
  ].filter((problem): problem is string => problem !== null);
  return (
    <>
      <View style={styles.headerControls}>
        <LabeledSwitch
          label="Wake agents"
          note={summary}
          value={wantedWakes ?? wakesOn}
          onChange={toggleWakes}
          styles={styles}
        />
        <LabeledSwitch
          label="Agent tools"
          value={wantedTools ?? stored?.agentTools ?? null}
          onChange={toggleTools}
          styles={styles}
        />
        {children}
      </View>
      <View style={styles.headerFields}>
        <SettingField
          label="Notes folder"
          hint="Where the stand-up notes are written. Empty turns them off."
          value={stored?.notesFolder ?? null}
          onSave={saveFolder}
          problem={saveProblem("Notes folder")}
          styles={styles}
        />
        <SettingField
          label="Time zone"
          hint="For the 8:00 run. Empty uses this host's."
          value={stored?.notesTimeZone ?? null}
          onSave={saveTimeZone}
          problem={timeZoneProblem}
          styles={styles}
        />
      </View>
      <TrackerFields
        values={stored}
        incidents={incidents}
        change={change}
        saveProblem={saveProblem}
        styles={styles}
      />
      {problems.length > 0 ? (
        <View style={styles.headerProblems}>
          {problems.map((problem) => (
            <Text key={problem} accessibilityRole="alert" style={styles.actionError}>
              {problem}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

interface TrackerFieldsProps {
  /** Null while the settings are read or cannot be read. */
  values: HostValues | null;
  incidents: TrackerState | undefined;
  change(setting: HostSetting, patch: Partial<HostValues>): Promise<boolean>;
  /** A refused save of the setting, if the last save was for it. */
  saveProblem(setting: HostSetting): string | null;
  styles: OfficeStyles;
}

/**
 * The trackers the incidents check reads, and its schedule's failure under them. A field set
 * while the host lacks the tracker's variables names them; the token itself never reaches here.
 */
function TrackerFields({ values, incidents, change, saveProblem, styles }: TrackerFieldsProps) {
  const saveJiraProjects = useCallback(
    (next: string) => change("Jira projects", { jiraProjects: next }),
    [change],
  );
  const saveSentryOrg = useCallback(
    (next: string) => change("Sentry organisation", { sentryOrg: next }),
    [change],
  );
  const saveSentryProjects = useCallback(
    (next: string) => change("Sentry projects", { sentryProjects: next }),
    [change],
  );
  const saveSentryUrl = useCallback(
    (next: string) => change("Sentry address", { sentryUrl: next }),
    [change],
  );
  const jiraProjects = values?.jiraProjects ?? null;
  const sentryOrg = values?.sentryOrg ?? null;
  const sentryProjects = values?.sentryProjects ?? null;
  // Not known until the host has said: no line before then.
  const jiraMissing = incidents?.jiraReady === false ? JIRA_UNSET : null;
  const sentryMissing = incidents?.sentryReady === false ? SENTRY_UNSET : null;
  // A refused save comes first; while the host refuses nothing, the variables it lacks.
  const jiraProblem = saveProblem("Jira projects") ?? unsetLine(jiraProjects, jiraMissing);
  const sentryOrgProblem =
    saveProblem("Sentry organisation") ?? unsetLine(sentryOrg, sentryMissing);
  const sentryProjectsProblem =
    saveProblem("Sentry projects") ?? unsetLine(sentryProjects, sentryMissing);
  const scheduleError = incidents?.scheduleError ?? null;
  return (
    <>
      <View style={styles.headerFields}>
        <SettingField
          label="Jira projects"
          hint="Project keys, comma separated. Needs ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN on the host."
          value={jiraProjects}
          onSave={saveJiraProjects}
          problem={jiraProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry organisation"
          hint="The organisation's slug. Needs SENTRY_AUTH_TOKEN on the host."
          value={sentryOrg}
          onSave={saveSentryOrg}
          problem={sentryOrgProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry projects"
          hint="Project slugs, comma separated. Needs SENTRY_AUTH_TOKEN on the host."
          value={sentryProjects}
          onSave={saveSentryProjects}
          problem={sentryProjectsProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry address"
          hint="Where SENTRY_AUTH_TOKEN is sent. https, or http on the host itself."
          value={values?.sentryUrl ?? null}
          onSave={saveSentryUrl}
          problem={saveProblem("Sentry address")}
          styles={styles}
        />
      </View>
      {scheduleError === null ? null : (
        <View style={styles.headerProblems}>
          <Text accessibilityRole="alert" style={styles.actionError}>
            {failureText("Schedule the incidents check", scheduleError)}
          </Text>
        </View>
      )}
    </>
  );
}

interface SettingFieldProps {
  label: string;
  hint: string;
  /** Null while the settings are read or cannot be read: the field is then not usable. */
  value: string | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: string): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}

/**
 * A host setting typed as text. It saves when it is submitted or loses focus, not on each
 * keystroke, since each save brings the daemon's schedule in step again. The text, trimmed, shows
 * until the host has answered; a refused save goes back to the stored value.
 */
function SettingField({ label, hint, value, onSave, problem, styles }: SettingFieldProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // What is typed, until the host has answered its save; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  // A submit blurs the field too: one save, not a second against a revision already gone.
  const saving = useRef(false);
  const commit = useCallback(() => {
    if (draft === null || saving.current) return;
    const next = draft.trim();
    if (value === null || next === value) {
      setDraft(null);
      return;
    }
    saving.current = true;
    setDraft(next);
    void onSave(next).finally(() => {
      saving.current = false;
      if (mounted.current) setDraft(null);
    });
  }, [draft, value, onSave]);
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={draft ?? value ?? ""}
        editable={value !== null}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldHint}>{hint}</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
