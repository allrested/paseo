import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ExternalLink, Modal } from "@getpaseo/plugin/client/ui";
import { ActionButton, failureText } from "./action-button.js";
import {
  QA_HELP,
  logCaption,
  qaSummary,
  type QaCheck,
  type QaScript,
  type QaTeam,
} from "./qa-text.js";
import type { OfficeStyles } from "./styles.js";
import type { ReadScriptLog, ScriptLog } from "./use-script-log.js";

interface CheckProps {
  check: QaCheck;
  styles: OfficeStyles;
}

function Check({ check, styles }: CheckProps) {
  return (
    <View style={styles.qaRow}>
      <Text style={styles.sheetText}>{check.name}</Text>
      <View style={styles.standupMeta}>
        <Text style={check.failing ? styles.qaTrouble : styles.rowMeta}>{check.detail}</Text>
        {check.url === null ? null : (
          <ExternalLink href={check.url} accessibilityLabel={`Open the run of ${check.name}`}>
            Run
          </ExternalLink>
        )}
      </View>
    </View>
  );
}

interface ScriptProps {
  roomId: string;
  script: QaScript;
  readLog: ReadScriptLog;
  styles: OfficeStyles;
}

function Script({ roomId, script, readLog, styles }: ScriptProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [log, setLog] = useState<ScriptLog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const read = useCallback(async () => {
    setFailure(null);
    try {
      const next = await readLog(roomId, script.name);
      if (mounted.current) setLog(next);
    } catch (caught) {
      if (mounted.current) setFailure(failureText("Read the log", caught));
    }
  }, [readLog, roomId, script.name]);
  const hide = useCallback(() => {
    setLog(null);
    setFailure(null);
  }, []);
  return (
    <View style={styles.qaRow}>
      <Text style={styles.sheetText}>{script.name}</Text>
      <Text style={script.troubled ? styles.qaTrouble : styles.rowMeta}>{script.line}</Text>
      {script.readable ? (
        <View style={styles.actions}>
          <ActionButton
            label={log === null ? "Show log" : "Refresh log"}
            pendingLabel="Reading..."
            onPress={read}
            styles={styles}
          />
          {log === null ? null : (
            <ActionButton
              label="Hide log"
              pendingLabel="Hiding..."
              onPress={hide}
              styles={styles}
            />
          )}
        </View>
      ) : null}
      {failure ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      ) : null}
      {log === null ? null : (
        <View style={styles.qaLog}>
          <Text style={styles.rowMeta}>
            {logCaption(log.lines.length, log.earlier, new Date(log.readAt).toLocaleTimeString())}
          </Text>
          {log.lines.length === 0 ? null : (
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Log of ${script.name}`}
              style={styles.qaLogBlock}
            >
              <Text selectable style={styles.qaLogText}>
                {log.lines.join("\n")}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

interface TeamProps {
  team: QaTeam;
  readLog: ReadScriptLog;
  styles: OfficeStyles;
}

function Team({ team, readLog, styles }: TeamProps) {
  return (
    <View style={styles.qaTeam}>
      <Text accessibilityRole="header" style={styles.standupHeading}>
        {team.name}
      </Text>
      {team.checks === null ? null : (
        <View style={styles.qaGroup}>
          <Text style={styles.sheetLabel}>Checks</Text>
          <Text style={team.checksFail ? styles.standupBlocker : styles.muted}>{team.checks}</Text>
          {team.runs.map((check) => (
            <Check key={check.name} check={check} styles={styles} />
          ))}
        </View>
      )}
      {team.tests.length === 0 ? null : (
        <View style={styles.qaGroup}>
          <Text style={styles.sheetLabel}>Test runs</Text>
          {team.tests.map((run) => (
            <Text
              key={run.agentId}
              style={run.state === "failed" ? styles.standupBlocker : styles.muted}
            >
              {run.line}
            </Text>
          ))}
        </View>
      )}
      {team.scripts.length === 0 ? null : (
        <View style={styles.qaGroup}>
          <Text style={styles.sheetLabel}>Scripts</Text>
          {team.scripts.map((script) => (
            <Script
              key={script.name}
              roomId={team.roomId}
              script={script}
              readLog={readLog}
              styles={styles}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export interface QaCardProps {
  teams: readonly QaTeam[];
  open: boolean;
  readLog: ReadScriptLog;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * What is under test, team by team: the pull request's pipeline with what fails and what runs,
 * the agents' own test runs, and the workspace's scripts with the end of their output.
 */
export function QaCard({ teams, open, readLog, styles, onClose }: QaCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="QA" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <View style={styles.sheetActions}>
            <Text style={styles.muted}>{qaSummary(teams)}</Text>
            <Text style={styles.rowMeta}>{QA_HELP}</Text>
          </View>
          {teams.length === 0 ? null : (
            <View style={styles.standupTeams}>
              {teams.map((team, index) => (
                <Fragment key={team.roomId}>
                  {index === 0 ? null : <View style={styles.rowDivider} />}
                  <Team team={team} readLog={readLog} styles={styles} />
                </Fragment>
              ))}
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
