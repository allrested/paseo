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
import { SKILLS } from "../shared/catalog.js";
import { statusRpc, type SyncStatus } from "../shared/rpc.js";
import { defaultSkillsSettings } from "../shared/settings.js";
import { describeSkill } from "./format.js";

const STATUS_KEY = ["default-skills", "status"] as const;
const SECTION_INFO =
  "Each skill is copied into Claude Code's skills folder at a reviewed commit. A folder of the same name that Paseo did not make is left alone. Agents pick up a change when their session starts.";

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
    <SettingsSection title="Skills" info={SECTION_INFO}>
      {problem ? (
        <Text accessibilityRole="alert" style={errorStyle}>
          {problem}
        </Text>
      ) : null}
      <SettingsCard>
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} settings={settings} status={status.data} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
