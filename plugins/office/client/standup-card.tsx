import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ExternalLink, Modal, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { ActionButton, failureText } from "./action-button.js";
import {
  askHint,
  askLabel,
  pullRequestLinkText,
  pullRequestRef,
  standupSummary,
  standupText,
  teamName,
  type StandupTeam,
} from "../shared/standup-text.js";
import type { OfficeStyles } from "./styles.js";

interface TeamProps {
  team: StandupTeam;
  styles: OfficeStyles;
}

/** A team's ticket: a link where the tracker gave its address. */
function Ticket({ team, styles }: TeamProps) {
  const { ticket } = team;
  if (ticket === null) return null;
  if (ticket.url === null) return <Text style={styles.rowMeta}>{ticket.key}</Text>;
  return (
    <ExternalLink href={ticket.url} accessibilityLabel={`Open ${ticket.key}`}>
      {ticket.key}
    </ExternalLink>
  );
}

function Team({ team, styles }: TeamProps) {
  const { branch, ticket, pullRequest } = team;
  return (
    <View style={styles.standupTeam}>
      <Text accessibilityRole="header" style={styles.standupHeading}>
        {teamName(team)}
      </Text>
      {branch !== null || ticket !== null || pullRequest !== null ? (
        <View style={styles.standupMeta}>
          {branch === null ? null : <Text style={styles.rowMeta}>{branch}</Text>}
          <Ticket team={team} styles={styles} />
          {pullRequest === null ? null : (
            <ExternalLink
              href={pullRequest.url}
              accessibilityLabel={`Open ${pullRequestRef(pullRequest)}`}
            >
              {pullRequestLinkText(pullRequest)}
            </ExternalLink>
          )}
        </View>
      ) : null}
      {team.review ? <Text style={styles.sheetText}>Pull request {team.review}</Text> : null}
      {team.tasks ? <Text style={styles.muted}>Board: {team.tasks}</Text> : null}
      {team.blockers.map((blocker) => (
        <Text key={blocker} style={styles.standupBlocker}>
          Blocked: {blocker}
        </Text>
      ))}
      <View style={styles.standupPeople}>
        {team.people.map((person) => (
          <View key={person.agentId}>
            <Text style={styles.sheetText}>
              {person.title}
              <Text style={styles.muted}> · {person.line}</Text>
            </Text>
            {person.said ? <Text style={styles.rowMeta}>Said: {person.said}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const NOBODY: ReadonlySet<string> = new Set();

export interface StandupCardProps {
  teams: readonly StandupTeam[];
  open: boolean;
  /** Posts the request for an update on a team's board, naming one agent. */
  ask(roomId: string, agentId: string): Promise<void>;
  /** "Wake agents" is off: a post would wait, so nobody is asked. */
  wakesPaused: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The stand-up: each team's ticket, branch and pull request, what blocks it, and what each of
 * its agents is at. Asking for updates posts on the teams' boards, where the agents answer.
 */
export function StandupCard({ teams, open, ask, wakesPaused, styles, onClose }: StandupCardProps) {
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  // Whom this stand-up has asked: an agent is asked once, also when it is idle again after its
  // answer. The two buttons share a row, so a failure goes under the row.
  const [asked, setAsked] = useState(NOBODY);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setAsked(NOBODY);
    setFailure(null);
  }, [open]);
  const free = useMemo(
    () =>
      teams.flatMap((team) =>
        team.people
          .filter((person) => person.free && !asked.has(person.agentId))
          .map((person) => ({ roomId: team.roomId, agentId: person.agentId })),
      ),
    [teams, asked],
  );
  const label = askLabel(free.length);
  const askAll = useCallback(async () => {
    setFailure(null);
    const reached: string[] = [];
    try {
      // One at a time: each post is a write of the boards' file.
      for (const { roomId, agentId } of free) {
        await ask(roomId, agentId);
        reached.push(agentId);
      }
    } catch (caught) {
      if (mounted.current) setFailure(failureText(label, caught));
    }
    if (mounted.current && reached.length > 0) {
      setAsked((before) => new Set([...before, ...reached]));
    }
  }, [ask, free, label]);
  const copy = useCallback(async () => {
    setFailure(null);
    try {
      await copyText(standupText(teams));
      toast.show("Stand-up copied");
    } catch (caught) {
      if (mounted.current) setFailure(failureText("Copy as text", caught));
    }
  }, [teams, toast]);
  return (
    <Modal title="Stand-up" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <Text style={styles.muted}>{standupSummary(teams)}</Text>
          <View style={styles.sheetActions}>
            <View style={styles.actions}>
              <ActionButton
                label={label}
                pendingLabel="Asking..."
                onPress={askAll}
                disabled={free.length === 0 || wakesPaused}
                styles={styles}
                primary
              />
              <ActionButton
                label="Copy as text"
                pendingLabel="Copying..."
                onPress={copy}
                disabled={teams.length === 0}
                styles={styles}
              />
            </View>
            {failure ? (
              <Text accessibilityRole="alert" style={styles.actionError}>
                {failure}
              </Text>
            ) : null}
            <Text style={styles.rowMeta}>
              {askHint({ free: free.length, asked: asked.size, wakesPaused })}
            </Text>
          </View>
          {teams.length === 0 ? null : (
            <View style={styles.standupTeams}>
              {teams.map((team, index) => (
                <Fragment key={team.roomId}>
                  {index === 0 ? null : <View style={styles.rowDivider} />}
                  <Team team={team} styles={styles} />
                </Fragment>
              ))}
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
