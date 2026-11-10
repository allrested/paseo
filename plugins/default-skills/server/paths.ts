import { join, resolve } from "node:path";

export interface SkillPaths {
  /** The main Claude config folder's `skills/`. claude-accounts links it into every account. */
  skillsDirectory: string;
  /** The folders this plugin created, so it never replaces or removes one it did not. */
  recordFile: string;
}

export function skillPaths(env: NodeJS.ProcessEnv, home: string): SkillPaths {
  const configDirectory = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const paseoHome = resolve(expandHome(env.PASEO_HOME || "~/.paseo", home));
  return {
    skillsDirectory: join(resolve(expandHome(configDirectory, home)), "skills"),
    recordFile: join(paseoHome, "default-skills", "installed.json"),
  };
}

function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  return input.startsWith("~/") ? join(home, input.slice(2)) : input;
}
