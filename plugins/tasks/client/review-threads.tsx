import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  COMMENT_MAX,
  replyThreadRpc,
  resolveThreadRpc,
  reviewThreadsRpc,
  type ReviewThread,
  type ReviewThreads as Review,
} from "../shared/contracts.js";
import { Button } from "./button.js";
import { commentMeta, resolvedToggle, threadCounts, threadName } from "./format.js";
import { Prose } from "./prose.js";
import { reason } from "./reason.js";
import type { TasksStyles } from "./tasks-styles.js";

interface Styled {
  styles: TasksStyles;
}

interface ThreadProps extends Styled {
  thread: ReviewThread;
  markdown: boolean;
  now: number;
  onReply(thread: string, text: string): Promise<void>;
  onResolve(thread: string, resolved: boolean): Promise<void>;
}

function Thread({ thread, markdown, now, onReply, onResolve, styles }: ThreadProps) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const name = threadName(thread);
  const open = useCallback(() => setReplying(true), []);
  const cancel = useCallback(() => setReplying(false), []);
  // Cleared only once it is posted: a refused reply stays to be sent again.
  const post = useCallback(async () => {
    await onReply(thread.id, text);
    setText("");
    setReplying(false);
  }, [onReply, thread.id, text]);
  const toggle = useCallback(
    () => onResolve(thread.id, !thread.resolved),
    [onResolve, thread.id, thread.resolved],
  );
  return (
    <View style={styles.thread}>
      <View style={styles.comment}>
        <Text selectable style={styles.threadWhere}>
          {thread.where ?? "On the whole merge request"}
        </Text>
        {thread.resolved ? (
          <Text style={styles.rowMeta}>
            {thread.resolvedBy === undefined ? "Resolved" : `Resolved by ${thread.resolvedBy}`}
          </Text>
        ) : null}
      </View>
      {thread.notes.map((note) => (
        <View key={note.id} style={styles.comment}>
          <Text style={styles.rowMeta}>{commentMeta(note, now)}</Text>
          <Prose text={note.text} markdown={markdown} styles={styles} />
        </View>
      ))}
      {replying ? (
        <View style={styles.block}>
          <TextInput
            accessibilityLabel={`Write a reply on ${name}`}
            value={text}
            onChangeText={setText}
            placeholder="Write a reply"
            placeholderTextColor={styles.placeholderColor}
            maxLength={COMMENT_MAX}
            multiline
            autoFocus
            style={styles.input}
          />
          <View style={styles.threadActions}>
            <Button
              label="Post reply"
              spoken={`Post the reply on ${name}`}
              pendingLabel="Posting..."
              onPress={post}
              disabled={text.trim() === ""}
              styles={styles}
              primary
            />
            <Button
              label="Cancel"
              spoken={`Cancel the reply on ${name}`}
              onPress={cancel}
              styles={styles}
            />
          </View>
        </View>
      ) : (
        <View style={styles.threadActions}>
          <Button label="Reply" spoken={`Reply on ${name}`} onPress={open} styles={styles} />
          {thread.resolved ? (
            <Button
              label="Reopen thread"
              spoken={`Reopen the thread on ${name}`}
              pendingLabel="Reopening..."
              onPress={toggle}
              styles={styles}
            />
          ) : (
            <Button
              label="Resolve thread"
              spoken={`Resolve the thread on ${name}`}
              pendingLabel="Resolving..."
              onPress={toggle}
              styles={styles}
            />
          )}
        </View>
      )}
    </View>
  );
}

export interface ReviewThreadsProps extends Styled {
  taskId: string;
  /** The tracker writes Markdown. */
  markdown: boolean;
  /** The tracker's name, for the line that says where the threads not read are. */
  tracker: string;
  now: number;
}

/**
 * A merge request's review threads: the open ones in full, each with a reply and a resolve, and
 * the resolved ones behind a button.
 */
export function ReviewThreads({ taskId, markdown, tracker, now, styles }: ReviewThreadsProps) {
  const read = useRpc(reviewThreadsRpc);
  const sendReply = useRpc(replyThreadRpc);
  const sendResolve = useRpc(resolveThreadRpc);
  const client = useQueryClient();
  const key = useMemo(() => ["tasks", "threads", taskId] as const, [taskId]);
  const review = useQuery({ queryKey: key, queryFn: () => read({ id: taskId }), retry: false });
  const [showResolved, setShowResolved] = useState(false);
  const toggleResolved = useCallback(() => setShowResolved((shown) => !shown), []);
  // Each change answers with the threads as they then are: the page shows that answer.
  const reply = useCallback(
    async (thread: string, text: string) => {
      const value = await sendReply({ id: taskId, thread, text }).catch((error: unknown) => {
        throw new Error(reason(error));
      });
      client.setQueryData<Review>(key, value);
    },
    [sendReply, taskId, client, key],
  );
  const resolve = useCallback(
    async (thread: string, resolved: boolean) => {
      const value = await sendResolve({ id: taskId, thread, resolved }).catch((error: unknown) => {
        throw new Error(reason(error));
      });
      client.setQueryData<Review>(key, value);
    },
    [sendResolve, taskId, client, key],
  );
  const { refetch } = review;
  const again = useCallback(async () => {
    await refetch();
  }, [refetch]);
  if (review.data === undefined) {
    if (!review.isError) return <Text style={styles.muted}>Loading...</Text>;
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.error}>
          {reason(review.error)}
        </Text>
        <Button label="Try again" onPress={again} styles={styles} />
      </View>
    );
  }
  const { threads, more } = review.data;
  if (threads.length === 0) return <Text style={styles.muted}>No review threads</Text>;
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);
  const shown = showResolved ? [...open, ...resolved] : open;
  return (
    <View style={styles.comments}>
      <Text style={styles.rowMeta}>{threadCounts(open.length, resolved.length)}</Text>
      {more ? (
        <Text style={styles.rowMeta}>{`${tracker} holds more threads than are shown here`}</Text>
      ) : null}
      {shown.map((thread) => (
        <Thread
          key={thread.id}
          thread={thread}
          markdown={markdown}
          now={now}
          onReply={reply}
          onResolve={resolve}
          styles={styles}
        />
      ))}
      {resolved.length === 0 ? null : (
        <Button
          label={resolvedToggle(resolved.length, showResolved)}
          onPress={toggleResolved}
          styles={styles}
        />
      )}
    </View>
  );
}
