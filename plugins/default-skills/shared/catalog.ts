/** One switch in the settings: a vendored upstream repository and the skill folders it installs. */
export interface SkillEntry {
  /** The settings key and the folder under `vendor/`. */
  id: string;
  label: string;
  summary: string;
  /** Folders under `vendor/<id>/`, each copied to the Claude skills folder under the same name. */
  folders: readonly string[];
  defaultOn: boolean;
}

// Pins and the files left out or edited are in vendor/SOURCES.md.
export const SKILLS = [
  {
    id: "ub-mode",
    label: "ub-mode",
    summary: "Uncle Bob's reduced engineering principles, used when you run /ub-mode",
    folders: ["ub-mode"],
    defaultOn: true,
  },
  {
    id: "ai-design-skills",
    label: "AI design skills",
    summary: "Landing page design and Figma design rules",
    folders: ["landing-page-design", "figma-designer"],
    defaultOn: true,
  },
  {
    id: "anti-slop",
    label: "Anti Slop",
    summary: "Rules against generic AI UI, copy and code comments",
    folders: [
      "antislop",
      "antislop-code",
      "antislop-copywriting",
      "antislop-human",
      "antislop-layoutmobile",
      "antislop-ui",
    ],
    defaultOn: true,
  },
  {
    id: "ui-ux-pro-max",
    label: "UI/UX Pro Max",
    summary: "Searchable UI and UX guidance with a local database; needs python3",
    folders: ["ui-ux-pro-max"],
    defaultOn: true,
  },
  {
    id: "unslop",
    label: "unslop",
    summary: "Turns AI-looking UI into a designed interface, one pass at a time",
    folders: ["unslop"],
    defaultOn: true,
  },
] as const satisfies readonly SkillEntry[];

export type SkillId = (typeof SKILLS)[number]["id"];
