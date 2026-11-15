import { useCallback, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import {
  ExternalLink,
  Icon,
  Markdown,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  COMMENT_MAX,
  SOURCE_NAME,
  type StatusChange,
  type TaskComment,
  type TaskDetail,
} from "../shared/contracts.js";
import { Button } from "./button.js";
import { useNow } from "./device.js";
import { ago, commentMeta, earlierComments, kindName } from "./format.js";
import { useLinkedWorkspaces, useRefreshLinked, workspacesOf } from "./linked.js";
import { nextTask, useNextTask } from "./next-task.js";
import { TaskImages } from "./task-images.js";
import type { TasksStyles } from "./tasks-styles.js";
import { useTaskDetail } from "./use-tasks.js";

interface Styled {
  styles: TasksStyles;
}

/** A tracker's text. GitLab writes Markdown; Jira's is plain, and its marks are not emphasis. */
function Prose({ text, markdown, styles }: Styled & { text: string; markdown: boolean }) {
  if (markdown) return <Markdown>{text}</Markdown>;
  return (
    <Text selectable style={styles.body}>
      {text}
    </Text>
  );
}

function Fact({ name, value, styles }: Styled & { name: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factName}>{name}</Text>
      <Text selectable style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

interface MoveProps extends Styled {
  change: StatusChange;
  onMove(change: string): Promise<void>;
}

function Move({ change, onMove, styles }: MoveProps) {
  const move = useCallback(() => onMove(change.id), [onMove, change.id]);
  return <Button label={change.label} pendingLabel="Moving..." onPress={move} styles={styles} />;
}

interface OpenWorkspaceProps extends Styled {
  label: string;
  workspaceId: string;
  onOpen(workspaceId: string): void;
}

function OpenWorkspace({ label, workspaceId, onOpen, styles }: OpenWorkspaceProps) {
  const open = useCallback(() => onOpen(workspaceId), [onOpen, workspaceId]);
  return <Button label={label} onPress={open} styles={styles} />;
}

interface WorkspacesProps extends Styled {
  task: TaskDetail;
  onOpen(workspaceId: string): void;
}

/** A way into each workspace that was started on this task; one alone needs no name. */
function Workspaces({ task, onOpen, styles }: WorkspacesProps) {
  const found = workspacesOf(useLinkedWorkspaces().data?.linked ?? [], task);
  return found.map((each) => (
    <OpenWorkspace
      key={each.workspaceId}
      label={found.length === 1 ? "Open workspace" : `Open ${each.name}`}
      workspaceId={each.workspaceId}
      onOpen={onOpen}
      styles={styles}
    />
  ));
}

interface WorkspacePickProps extends Styled {
  taskId: string;
  taskKey: string;
  url: string;
  branch: string;
}

/** Hands an issue to the New workspace screen's Task field, or takes it back. */
function WorkspacePick({ taskId, taskKey, url, branch, styles }: WorkspacePickProps) {
  const picked = useNextTask()?.key === taskKey;
  const toast = useToast();
  const toggle = useCallback(() => {
    if (picked) {
      nextTask.set(null);
      return;
    }
    nextTask.set({ id: taskId, key: taskKey, url, branch });
    toast.show(`New workspace will start on ${taskKey}`);
  }, [picked, taskId, taskKey, url, branch, toast]);
  return (
    <Button
      label={picked ? "Do not use for the next workspace" : "Use for the next workspace"}
      onPress={toggle}
      styles={styles}
    />
  );
}

interface CommentBoxProps extends Styled {
  /** The tracker's name, for the line that says whose words these will be. */
  tracker: string;
  onPost(text: string): Promise<void>;
}

function CommentBox({ tracker, onPost, styles }: CommentBoxProps) {
  const [text, setText] = useState("");
  // Cleared only once it is posted: a refused comment stays to be sent again.
  const post = useCallback(async () => {
    await onPost(text);
    setText("");
  }, [onPost, text]);
  return (
    <View style={styles.block}>
      <TextInput
        accessibilityLabel="Write a comment"
        value={text}
        onChangeText={setText}
        placeholder="Write a comment"
        placeholderTextColor={styles.placeholderColor}
        maxLength={COMMENT_MAX}
        multiline
        style={styles.input}
      />
      <Text style={styles.rowMeta}>{`Posts to ${tracker} as the account saved on this host`}</Text>
      <Button
        label="Post comment"
        pendingLabel="Posting..."
        onPress={post}
        disabled={text.trim() === ""}
        styles={styles}
        primary
      />
    </View>
  );
}

function Comments({ task, now, styles }: Styled & { task: TaskDetail; now: number }) {
  if (task.comments.length === 0 && task.earlierComments === 0) {
    return <Text style={styles.muted}>No comments yet</Text>;
  }
  return (
    <View style={styles.comments}>
      {task.earlierComments > 0 ? (
        <Text style={styles.rowMeta}>{earlierComments(task.earlierComments, task.source)}</Text>
      ) : null}
      {task.comments.map((comment: TaskComment) => (
        <View key={comment.id} style={styles.comment}>
          <Text style={styles.rowMeta}>{commentMeta(comment, now)}</Text>
          <Prose text={comment.text} markdown={task.markdown} styles={styles} />
        </View>
      ))}
    </View>
  );
}

interface PageProps extends Styled {
  task: TaskDetail;
  /** Why the newest read failed; the task shown is from before it. */
  stale: string | null;
  now: number;
  onMove(change: string): Promise<void>;
  onPost(text: string): Promise<void>;
  onAssign(): Promise<void>;
  /** Absent on a host whose screens cannot open a workspace. */
  onOpenWorkspace?: (workspaceId: string) => void;
}

function Page({ task, stale, now, onMove, onPost, onAssign, onOpenWorkspace, styles }: PageProps) {
  const tracker = SOURCE_NAME[task.source];
  return (
    <>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>{`${task.key} · ${kindName(task)}`}</Text>
        <Text accessibilityRole="header" selectable style={styles.title}>
          {task.title}
        </Text>
      </View>
      {stale === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {stale}
        </Text>
      )}
      <View style={styles.facts}>
        <Fact name="Status" value={task.status} styles={styles} />
        {task.details.map(([name, value]) => (
          <Fact key={name} name={name} value={value} styles={styles} />
        ))}
        {task.updatedAt === undefined ? null : (
          <Fact name="Updated" value={ago(task.updatedAt, now)} styles={styles} />
        )}
      </View>
      {task.changes.length === 0 ? null : (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Move to</Text>
          <View style={styles.actions}>
            {task.changes.map((change) => (
              <Move key={change.id} change={change} onMove={onMove} styles={styles} />
            ))}
          </View>
        </View>
      )}
      <View style={styles.actions}>
        {task.assignedToMe ? null : (
          <Button
            label="Assign to me"
            pendingLabel="Assigning..."
            onPress={onAssign}
            styles={styles}
          />
        )}
        {onOpenWorkspace === undefined ? null : (
          <Workspaces task={task} onOpen={onOpenWorkspace} styles={styles} />
        )}
        {task.branch === undefined ? null : (
          <WorkspacePick
            taskId={task.id}
            taskKey={task.key}
            url={task.url}
            branch={task.branch}
            styles={styles}
          />
        )}
        <ExternalLink href={task.url}>{`Open in ${tracker}`}</ExternalLink>
      </View>
      <View style={styles.block}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Description
        </Text>
        {task.description === "" ? (
          <Text style={styles.muted}>No description</Text>
        ) : (
          <Prose text={task.description} markdown={task.markdown} styles={styles} />
        )}
        <TaskImages taskId={task.id} images={task.images} styles={styles} />
      </View>
      <View style={styles.block}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Comments
        </Text>
        <View style={styles.comments}>
          <Comments task={task} now={now} styles={styles} />
          <CommentBox tracker={tracker} onPost={onPost} styles={styles} />
        </View>
      </View>
    </>
  );
}

export interface TaskDetailPaneProps extends Styled {
  id: string;
  /** Returns to the list, where the page covers it and the host's header has no way back. */
  onBack?: () => void;
  /** Opens a workspace that was started on the task. Absent on a host that cannot. */
  onOpenWorkspace?: (workspaceId: string) => void;
}

/** One task's page: what it is, where it can move, what was said, and a box to answer. */
export function TaskDetailPane({ id, styles, onBack, onOpenWorkspace }: TaskDetailPaneProps) {
  const task = useTaskDetail(id);
  const now = useNow();
  const refreshLinked = useRefreshLinked();
  const { change } = task;
  // The sidebar's badge shows how the task stands: it is read again once the task has moved.
  const move = useCallback(
    async (to: string) => {
      await change(to);
      refreshLinked();
    },
    [change, refreshLinked],
  );
  const backStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.backPressed : styles.back),
    [styles],
  );
  let body;
  if (task.value !== null) {
    body = (
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
        <Page
          task={task.value}
          stale={task.error}
          now={now}
          onMove={move}
          onPost={task.comment}
          onAssign={task.assign}
          onOpenWorkspace={onOpenWorkspace}
          styles={styles}
        />
      </ScrollView>
    );
  } else if (task.error === null) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading...</Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.empty}>
        <Text accessibilityRole="alert" style={styles.emptyText}>
          {task.error}
        </Text>
        <Button label="Try again" onPress={task.reload} styles={styles} />
      </View>
    );
  }
  if (onBack === undefined) return body;
  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the list"
        onPress={onBack}
        style={backStyle}
      >
        <Icon name="ChevronLeft" size={16} color={styles.iconColor} />
        <Text style={styles.muted}>All tasks</Text>
      </Pressable>
      {body}
    </View>
  );
}
