import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { DESIGN_BUNDLE, SKILLS, type SkillId } from "../shared/catalog.js";
import { statusRpc, type SyncStatus } from "../shared/rpc.js";
import { defaultSkillsSettings } from "../shared/settings.js";
import { countOn, describeBundle, switchBundle } from "./bundle.js";
import { describeSkill } from "./format.js";

const STATUS_KEY = ["default-skills", "status"] as const;
const SECTION_INFO =
  "Each skill is copied into Claude Code's skills folder at a reviewed commit. A folder of the same name that Paseo did not make is left alone. Agents pick up a change when their session starts.";
const BUNDLE_INFO = `The design skills, kept together so that what an agent designs does not look generated. The first switch turns all of them on or off. ${SECTION_INFO}`;
const BUNDLE_MEMBERS: ReadonlySet<SkillId> = new Set(DESIGN_BUNDLE.members);
const BUNDLE_SKILLS = SKILLS.filter((skill) => BUNDLE_MEMBERS.has(skill.id));
const OTHER_SKILLS = SKILLS.filter((skill) => !BUNDLE_MEMBERS.has(skill.id));
const DEFAULT_SWITCHES = defaultSkillsSettings.schema.parse({});

type SkillsSettingsState = SettingsState<typeof defaultSkillsSettings.schema>;
type CatalogSkill = (typeof SKILLS)[number];

interface SkillRowProps {
  skill: CatalogSkill;
  settings: SkillsSettingsState;
  status: SyncStatus | undefined;
}

function SkillRow({ skill, settings, status }: SkillRowProps) {
  const queryClient = useQueryClient();
  const change = useCallback(
    async (next: boolean) => {
      if (settings.status !== "ready") return;
      const values = { ...settings.values, [skill.id]: next };
      // save() never throws; the status RPC waits for the sync the save starts.
      if (await settings.save(values, settings.revision)) {
        await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      }
    },
    [settings, skill.id, queryClient],
  );
  const line = describeSkill(status, skill.id);
  const value = settings.status === "ready" ? settings.values[skill.id] : skill.defaultOn;
  return (
    <SettingsSwitch
      label={skill.label}
      hint={`${skill.summary}. ${line.state}`}
      error={line.error}
      value={value}
      disabled={settings.status !== "ready" || settings.saving}
      onValueChange={change}
    />
  );
}

function BundleRow({ settings }: { settings: SkillsSettingsState }) {
  const queryClient = useQueryClient();
  const members = DESIGN_BUNDLE.members;
  const change = useCallback(
    async (next: boolean) => {
      if (settings.status !== "ready") return;
      const values = switchBundle(settings.values, members, next);
      // One save for every member, so one sync installs or removes them together.
      if (await settings.save(values, settings.revision)) {
        await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      }
    },
    [settings, members, queryClient],
  );
  const on = countOn(settings.status === "ready" ? settings.values : DEFAULT_SWITCHES, members);
  return (
    <SettingsSwitch
      label="All design skills"
      hint={describeBundle(on, members.length)}
      value={on === members.length}
      disabled={settings.status !== "ready" || settings.saving}
      onValueChange={change}
    />
  );
}

export function SkillsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(defaultSkillsSettings);
  // The settings kit's row error size; the plugin theme has colors only.
  const errorStyle = useMemo(
    () => ({ color: theme.colors.statusDanger, fontSize: 12, paddingHorizontal: 16 }),
    [theme],
  );
  const fetchStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => fetchStatus({}), retry: false });
  const problem =
    settings.status === "error" || settings.status === "invalid"
      ? settings.error
      : (settings.saveError ?? status.error?.message ?? null);
  return (
    <>
      <SettingsSection title={DESIGN_BUNDLE.label} info={BUNDLE_INFO}>
        {problem ? (
          <Text accessibilityRole="alert" style={errorStyle}>
            {problem}
          </Text>
        ) : null}
        <SettingsCard>
          <BundleRow settings={settings} />
          {BUNDLE_SKILLS.map((skill) => (
            <SkillRow key={skill.id} skill={skill} settings={settings} status={status.data} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Other skills" info={SECTION_INFO}>
        <SettingsCard>
          {OTHER_SKILLS.map((skill) => (
            <SkillRow key={skill.id} skill={skill} settings={settings} status={status.data} />
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
