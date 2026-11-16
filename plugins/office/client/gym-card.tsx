import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import type { SkillInfo, SkillsResult } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { Chip } from "./board-sheet.js";
import {
  GYM_HELP,
  gymSummary,
  HOST_SKILLS_SHOWN,
  skillWhere,
  TOPIC_MAX,
  trainHint,
  type GymAsked,
  type GymTeam,
} from "./gym-text.js";
import type { OfficeStyles } from "./styles.js";

interface SkillRowProps {
  skill: SkillInfo;
  styles: OfficeStyles;
}

function SkillRow({ skill, styles }: SkillRowProps) {
  return (
    <View style={styles.qaRow}>
      <Text style={styles.sheetText}>{skill.name}</Text>
      {skill.description === null ? null : <Text style={styles.rowMeta}>{skill.description}</Text>}
      <Text style={styles.rowMeta}>{skillWhere(skill)}</Text>
    </View>
  );
}

interface AskedProps {
  asked: GymAsked;
  onOpenBoard(): void;
  styles: OfficeStyles;
}

/** The newest request for a skill and what came of it. */
function Asked({ asked, onOpenBoard, styles }: AskedProps) {
  return (
    <View style={styles.reviewAnswer}>
      {asked.text === null ? (
        <Text style={styles.rowMeta}>
          Asked {asked.title} for “{asked.topic}”. Its note shows here once it is on the board.
        </Text>
      ) : (
        <>
          <Text style={styles.rowMeta}>
            {asked.title} on “{asked.topic}”
          </Text>
          <Text style={styles.sheetText}>{asked.text}</Text>
          {asked.cut ? <Text style={styles.rowMeta}>The board has the rest.</Text> : null}
        </>
      )}
      <View style={styles.actions}>
        <ActionButton
          label="Open board"
          pendingLabel="Opening..."
          onPress={onOpenBoard}
          styles={styles}
        />
      </View>
    </View>
  );
}

interface TeachProps {
  team: GymTeam;
  wakesPaused: boolean;
  teach(team: GymTeam, agentId: string, topic: string): Promise<void>;
  styles: OfficeStyles;
}

/** What the skill should teach, who writes it, and the button that asks. */
function Teach({ team, wakesPaused, teach, styles }: TeachProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The agent picked may have gone to work since: then the newest idle one writes it.
  const chosen =
    team.trainers.find((trainer) => trainer.agentId === picked) ?? team.trainers[0] ?? null;
  const label = chosen === null ? "Ask" : `Ask ${chosen.title} to write it`;
  const ask = useCallback(async () => {
    if (chosen === null) return;
    const sent = topic.trim();
    setFailure(null);
    try {
      await teach(team, chosen.agentId, sent);
      if (mounted.current) setTopic((current) => textAfterSend(current, sent));
    } catch (caught) {
      if (mounted.current) setFailure(failureText(label, caught));
    }
  }, [chosen, topic, teach, team, label]);
  const hint = trainHint(team, chosen?.title ?? null, wakesPaused);
  if (chosen === null) return <Text style={styles.muted}>{hint}</Text>;
  return (
    <View style={styles.sheetField}>
      <Text style={styles.rowMeta}>What it should teach</Text>
      <TextInput
        accessibilityLabel={`What a skill of ${team.name} should teach`}
        value={topic}
        onChangeText={setTopic}
        placeholder="How this project cuts a release"
        placeholderTextColor={styles.placeholderColor}
        maxLength={TOPIC_MAX}
        // (multiline so a long topic and the placeholder wrap; a line break becomes a space)
        multiline
        style={styles.input}
      />
      {team.trainers.length > 1 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Who writes it">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            {team.trainers.map((trainer) => (
              <Chip
                key={trainer.agentId}
                label={trainer.title}
                value={trainer.agentId}
                selected={trainer.agentId === chosen.agentId}
                onSelect={setPicked}
                styles={styles}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.actions}>
        <ActionButton
          label={label}
          pendingLabel="Asking..."
          onPress={ask}
          disabled={wakesPaused || topic.trim().length === 0}
          styles={styles}
        />
      </View>
      {failure ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      ) : null}
      <Text style={styles.rowMeta}>{hint}</Text>
    </View>
  );
}

interface TeamProps {
  team: GymTeam;
  /** The skills were read at least once; "failed" when the first reading failed. */
  read: boolean | "failed";
  wakesPaused: boolean;
  teach(team: GymTeam, agentId: string, topic: string): Promise<void>;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
}

function teamSkillsLine(team: GymTeam, read: boolean | "failed"): string | null {
  if (read === "failed") return "Not read.";
  if (!read) return "Reading...";
  if (team.skills === null) return "The host has no folder for this workspace.";
  return team.skills.length === 0 ? "None in this workspace yet." : null;
}

function Team({ team, read, wakesPaused, teach, onOpenBoard, styles }: TeamProps) {
  const openBoard = useCallback(() => onOpenBoard(team.roomId), [onOpenBoard, team.roomId]);
  const line = teamSkillsLine(team, read);
  return (
    <View style={styles.qaTeam}>
      <Text accessibilityRole="header" style={styles.standupHeading}>
        {team.name}
      </Text>
      {team.training.length === 0 ? null : (
        <Text style={styles.rowMeta}>At a skill now: {team.training.join(", ")}</Text>
      )}
      <View style={styles.qaGroup}>
        <Text style={styles.sheetLabel}>Skills</Text>
        {line === null ? null : <Text style={styles.muted}>{line}</Text>}
        {(team.skills ?? []).map((skill) => (
          <SkillRow key={skill.name} skill={skill} styles={styles} />
        ))}
      </View>
      <View style={styles.qaGroup}>
        <Text style={styles.sheetLabel}>Teach a skill</Text>
        <Teach team={team} wakesPaused={wakesPaused} teach={teach} styles={styles} />
        {team.asked ? <Asked asked={team.asked} onOpenBoard={openBoard} styles={styles} /> : null}
      </View>
    </View>
  );
}

interface HostSkillsProps {
  skills: readonly SkillInfo[];
  styles: OfficeStyles;
}

/** The host's own skills, folded when there are many: the teams come first. */
function HostSkills({ skills, styles }: HostSkillsProps) {
  const folds = skills.length > HOST_SKILLS_SHOWN;
  const [shown, setShown] = useState(false);
  const toggle = useCallback(() => setShown((current) => !current), []);
  const label = shown ? "Hide the host's skills" : `Show ${skills.length} skills`;
  return (
    <View style={styles.qaGroup}>
      <Text accessibilityRole="header" style={styles.standupHeading}>
        On this host
      </Text>
      <Text style={styles.rowMeta}>Every agent of a tool that reads these folders has them.</Text>
      {skills.length === 0 ? <Text style={styles.muted}>No skills.</Text> : null}
      {folds ? (
        <View style={styles.actions}>
          <ActionButton label={label} pendingLabel={label} onPress={toggle} styles={styles} />
        </View>
      ) : null}
      {!folds || shown
        ? skills.map((skill) => <SkillRow key={skill.name} skill={skill} styles={styles} />)
        : null}
    </View>
  );
}

export interface GymCardProps {
  teams: readonly GymTeam[];
  skills: SkillsResult | null;
  /** Why the last reading failed; null when it did not. */
  readFailure: string | null;
  open: boolean;
  read(): Promise<void>;
  teach(team: GymTeam, agentId: string, topic: string): Promise<void>;
  /** "Wake agents" is off: a request would wait, so nobody is asked. */
  wakesPaused: boolean;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The gym: the skills the teams' workspaces and the host have, who is at one now, and a request
 * to an idle agent to write a new one from its work.
 */
export function GymCard({
  teams,
  skills,
  readFailure,
  open,
  read,
  teach,
  wakesPaused,
  onOpenBoard,
  styles,
  onClose,
}: GymCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Gym" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <View style={styles.sheetActions}>
            <Text style={styles.muted}>{gymSummary(teams, skills, readFailure !== null)}</Text>
            <Text style={styles.rowMeta}>{GYM_HELP}</Text>
            <View style={styles.actions}>
              <ActionButton
                label="Read again"
                pendingLabel="Reading..."
                onPress={read}
                styles={styles}
              />
            </View>
            {skills === null ? null : (
              <Text style={styles.rowMeta}>
                Read at {new Date(skills.readAt).toLocaleTimeString()}
              </Text>
            )}
            {readFailure ? (
              <Text accessibilityRole="alert" style={styles.actionError}>
                {readFailure}
              </Text>
            ) : null}
          </View>
          {teams.length === 0 ? null : (
            <View style={styles.standupTeams}>
              {teams.map((team, index) => (
                <Fragment key={team.roomId}>
                  {index === 0 ? null : <View style={styles.rowDivider} />}
                  <Team
                    team={team}
                    read={skills === null && readFailure !== null ? "failed" : skills !== null}
                    wakesPaused={wakesPaused}
                    teach={teach}
                    onOpenBoard={onOpenBoard}
                    styles={styles}
                  />
                </Fragment>
              ))}
              {skills === null ? null : (
                <>
                  <View style={styles.rowDivider} />
                  <HostSkills skills={skills.host} styles={styles} />
                </>
              )}
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
