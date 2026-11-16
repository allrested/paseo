import type { OfficeAgent, Post, SkillInfo, SkillsResult } from "../shared/contracts.js";
import {
  askedOf,
  idleAgents,
  isUserRequest,
  latestRequest,
  type AskAgent,
  type Asked,
} from "./ask-text.js";
import type { HostNote } from "./machine-text.js";
import { agentTitle, type OfficeModel, type OfficeRoom } from "./model.js";
import { teamName } from "./standup-text.js";

/** How a request for a skill starts on the board: the office finds its own requests by it. */
export const SKILL_MARK = "Skill request: ";
/** A topic is one line of at most this many characters. */
export const TOPIC_MAX = 200;
/** What an agent's answer is cut at in the card; the board has all of it. */
const ANSWER_MAX = 600;
/** The host's skills are folded behind a button above this many: the teams come first. */
export const HOST_SKILLS_SHOWN = 6;

/** The newest request for a skill, what it asked for, and the note that answered it. */
export interface LibraryAsked extends Asked {
  topic: string;
}

export interface LibraryTeam {
  /** The team's room: its workspace's id. */
  roomId: string;
  name: string;
  /** The team's agents at a skill now, by name. */
  atSkill: string[];
  /** Who can be asked to write a skill: the idle agents, the newest first. */
  writers: AskAgent[];
  asked: LibraryAsked | null;
  /** The workspace's skills; null before the first reading and for a workspace with no folder. */
  skills: readonly SkillInfo[] | null;
}

/** A topic on one line, at most TOPIC_MAX characters. */
export function topicOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX);
}

/** Where an agent is told to put the skill: Claude Code's folder by name, another tool's its own. */
function placeFor(provider: string): string {
  return provider === "claude"
    ? "in .claude/skills/<name>/SKILL.md of this workspace"
    : "in the folder of this workspace that your tool reads skills from, as <name>/SKILL.md";
}

/**
 * What an agent is asked: a note that names it. The first line marks the note as a request for
 * a skill and says what the skill teaches.
 */
export function skillAsk(topic: string, provider: string): string {
  return [
    `${SKILL_MARK}${topicOf(topic)}`,
    `Write a skill that teaches this, with the steps taken from your work in this workspace. Put it ${placeFor(provider)}. Its front matter has a name, and a description that says when to use it. Change no other file.`,
    "Then post one note on this board with the skill's name and what it teaches.",
  ].join("\n");
}

function isSkillRequest(post: Post): boolean {
  return isUserRequest(post) && post.text.startsWith(SKILL_MARK);
}

function libraryAskedOf(
  room: OfficeRoom,
  agents: ReadonlyMap<string, OfficeAgent>,
): LibraryAsked | null {
  const found = latestRequest(room.posts, isSkillRequest);
  if (found === null) return null;
  const answer = askedOf(found, agents, ANSWER_MAX);
  const [first = ""] = found.request.text.split("\n");
  return {
    agentId: answer.agentId,
    title: answer.title,
    text: answer.text,
    cut: answer.cut,
    topic: first.slice(SKILL_MARK.length),
  };
}

/** Every workspace's team: its skills, who is at a skill now, and who can be asked for one. */
export function libraryTeams(
  model: Pick<OfficeModel, "rooms" | "agents">,
  skills: SkillsResult | null,
): LibraryTeam[] {
  const teams: LibraryTeam[] = [];
  for (const room of model.rooms) {
    if (room.workspace === null) continue;
    teams.push({
      roomId: room.id,
      name: teamName({ name: room.name, project: room.subtitle }),
      atSkill: room.rows
        .filter((row) => row.step?.kind === "skill")
        .map((row) => agentTitle(row.agent)),
      writers: idleAgents(room).map((agent) => ({ agentId: agent.id, title: agentTitle(agent) })),
      asked: libraryAskedOf(room, model.agents),
      skills: skills?.workspaces[room.id] ?? null,
    });
  }
  return teams;
}

function atSkill(teams: readonly LibraryTeam[]): string[] {
  return teams.flatMap((team) => team.atSkill);
}

/** The library in a few words, for the strip; null in an office without a team. */
export function libraryNote(teams: readonly LibraryTeam[]): HostNote | null {
  if (teams.length === 0) return null;
  const at = atSkill(teams).length;
  return { text: at > 0 ? `${at} at a skill` : "Teach a skill", tone: "muted" };
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** The card's first line: how many skills there are, and who is at one now. */
export function librarySummary(
  teams: readonly LibraryTeam[],
  skills: SkillsResult | null,
  failed = false,
): string {
  if (skills === null) {
    return failed ? "The skills could not be read." : "Reading the skills on this host.";
  }
  const inTeams = teams.reduce((sum, team) => sum + (team.skills?.length ?? 0), 0);
  const listed =
    skills.host.length === 0 && inTeams === 0
      ? "No skills on this host or in the teams' workspaces."
      : `${count(skills.host.length, "skill", "skills")} on this host, ${inTeams} in the teams' workspaces.`;
  const at = atSkill(teams);
  if (at.length === 0) return listed;
  return at.length === 1
    ? `${listed} ${at[0]} is at a skill now.`
    : `${listed} ${at.length} agents are at a skill now.`;
}

/** What the card says under its first line: what teaching a skill does. */
export const LIBRARY_HELP =
  "Name what a skill should teach and an idle agent of the team writes it from its work in the workspace, as a folder with a SKILL.md. It is in the workspace's changes, to review before it is merged.";

/** The folders a skill is in: "In .claude and .agents". */
export function skillWhere(skill: Pick<SkillInfo, "folders">): string {
  const { folders } = skill;
  if (folders.length <= 1) return `In ${folders[0] ?? ""}`;
  return `In ${folders.slice(0, -1).join(", ")} and ${folders.at(-1)}`;
}

/** The line under the button: who is asked, or why nobody can be. */
export function askHint(
  team: Pick<LibraryTeam, "writers">,
  chosen: string | null,
  wakesPaused: boolean,
): string {
  if (team.writers.length === 0 || chosen === null) {
    return "No agent of this team is idle, so nobody can be asked.";
  }
  if (wakesPaused) return "Wake agents is off, so a request would wait. Turn it on to ask.";
  return `${chosen} writes it and answers on the team's board.`;
}
