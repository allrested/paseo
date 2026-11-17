import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { POST_TEXT_MAX, type ChecklistStep, type Post } from "../shared/contracts.js";
import type { AgentTaskGroup } from "../shared/model.js";
import { ActionButton, failureText } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { AgentPicker } from "./agent-picker.js";
import { NOBODY } from "./agent-picker-text.js";
import { PostWithActions, WakeField, useWakeChoice, type SheetBodyProps } from "./board-sheet.js";
import { clearQuestion, stepMark, todoMeta } from "./board-text.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";
import { listenForSpace } from "./web-env.web.js";

/** False once the component has gone: an answer that comes later changes nothing. */
function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

interface DeleteQuestionProps {
  question: string;
  onDelete(): Promise<void>;
  onKeep(): void;
  styles: OfficeStyles;
}

/**
 * What is deleted is gone for good, so Delete asks once more. The question takes the place of the
 * button and moves the buttons down a line: a second tap in the same place lands on the words.
 */
function DeleteQuestion({ question, onDelete, onKeep, styles }: DeleteQuestionProps) {
  return (
    <>
      <Text style={styles.sheetText}>{question}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Delete"
          pendingLabel="Deleting..."
          onPress={onDelete}
          styles={styles}
        />
        <ActionButton label="Keep" pendingLabel="Keeping..." onPress={onKeep} styles={styles} />
      </View>
    </>
  );
}

interface TodoRowProps {
  post: Post;
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
}

/** A to-do: its checkbox ticks or unticks it, and Delete asks first. */
function TodoRow({ post, name, actions, styles }: TodoRowProps) {
  const done = post.state === "done";
  const meta = todoMeta(post, name);
  const mounted = useMounted();
  // The box shows the board's state: it changes when the board does, and is off until the answer.
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set before the first await, so a second tap before the re-render cannot send twice.
  const inFlight = useRef(false);
  const toggle = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      await (done ? actions.reopen(post.id) : actions.markDone(post.id));
    } catch (caught) {
      if (mounted.current) setFailure(failureText(done ? "Reopen" : "Mark done", caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, [actions, post.id, done, mounted]);
  // Enter presses any Pressable; Space, the key that ticks a checkbox, only a button.
  const id = useId();
  useEffect(() => listenForSpace(id, toggle), [id, toggle]);
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const remove = useCallback(() => actions.remove(post.id), [actions, post.id]);
  return (
    <View style={styles.boardPost}>
      <Pressable
        id={id}
        accessibilityRole="checkbox"
        accessibilityLabel={meta === null ? post.text : `${post.text}, ${meta}`}
        aria-checked={done}
        disabled={pending}
        onPress={toggle}
        style={pending ? styles.todoRowDisabled : styles.todoRow}
      >
        <Icon name={done ? "SquareCheck" : "Square"} size={20} color={styles.iconColor} />
        <View style={styles.rowBody}>
          <Text style={done ? styles.todoTextDone : styles.postText}>{post.text}</Text>
          {meta === null ? null : <Text style={styles.postMeta}>{meta}</Text>}
        </View>
      </Pressable>
      {failure === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      )}
      {asking ? (
        <DeleteQuestion
          question="Delete this post?"
          onDelete={remove}
          onKeep={keep}
          styles={styles}
        />
      ) : (
        <View style={styles.actions}>
          <ActionButton label="Delete" pendingLabel="Deleting..." onPress={ask} styles={styles} />
        </View>
      )}
    </View>
  );
}

interface TodoHeadingProps {
  board: string;
  /** How many to-dos are done now. */
  done: number;
  actions: BoardActions;
  styles: OfficeStyles;
}

/** The list's heading, and on its right "Clear finished", which deletes the done to-dos. */
function TodoHeading({ board, done, actions, styles }: TodoHeadingProps) {
  const mounted = useMounted();
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const clear = useCallback(async () => {
    await actions.clearDone(board);
    if (mounted.current) setAsking(false);
  }, [actions, board, mounted]);
  // The count follows the board; once another hand has cleared them there is nothing to ask.
  const showsQuestion = asking && done > 0;
  return (
    <View style={styles.boardTitleRow}>
      <Text style={styles.sheetLabel}>To-do</Text>
      {showsQuestion ? (
        <View style={styles.sheetActions}>
          <DeleteQuestion
            question={clearQuestion(done)}
            onDelete={clear}
            onKeep={keep}
            styles={styles}
          />
        </View>
      ) : (
        <ActionButton
          label="Clear finished"
          pendingLabel="Clearing..."
          onPress={ask}
          disabled={done === 0}
          styles={styles}
        />
      )}
    </View>
  );
}

interface StepLine {
  key: string;
  text: string;
}

/**
 * A step's line, with a key: a step has no id, and a checklist may repeat a line ("Run tests"),
 * so the key is the text and how many times it has come so far.
 */
function stepLines(steps: readonly ChecklistStep[]): StepLine[] {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const count = (seen.get(step.text) ?? 0) + 1;
    seen.set(step.text, count);
    return { key: `${count}:${step.text}`, text: `${stepMark(step.status)} ${step.text}` };
  });
}

interface TaskGroupProps {
  group: AgentTaskGroup;
  name(author: string): string;
  styles: OfficeStyles;
}

/** An agent's name, then its unfinished steps in its own order, one line each. Read only. */
function TaskGroup({ group, name, styles }: TaskGroupProps) {
  const lines = useMemo(() => stepLines(group.steps), [group.steps]);
  return (
    <View style={styles.post}>
      <Text style={styles.postMeta}>{name(group.agentId)}</Text>
      {lines.map((line) => (
        <Text key={line.key} style={styles.postText} numberOfLines={1}>
          {line.text}
        </Text>
      ))}
    </View>
  );
}

export interface LobbyBodyProps extends SheetBodyProps {
  /** Every agent's unfinished checklist steps, in the office's order. */
  agentTasks: readonly AgentTaskGroup[];
}

/** The lobby's board: a to-do list, the lobby's notes, and the steps each agent is working through. */
export function LobbyBody({
  room,
  rooms,
  name,
  agentTasks,
  actions,
  wakesPaused,
  picking,
  onPicking,
  styles,
}: LobbyBodyProps) {
  const [text, setText] = useState("");
  const { to, fieldId, open, back, choose, reset } = useWakeChoice({ rooms, picking, onPicking });
  const mounted = useMounted();
  // Enter adds as well as the button, so the form keeps its own pending state and failure.
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set before the first await, so a second Enter before the re-render cannot add twice.
  const inFlight = useRef(false);
  const add = useCallback(async () => {
    const sent = text.trim();
    if (sent === "" || inFlight.current) return;
    inFlight.current = true;
    setAdding(true);
    setFailure(null);
    try {
      await actions.post({
        board: room.id,
        kind: "task",
        text: sent,
        ...(to === NOBODY ? {} : { to }),
      });
      if (!mounted.current) return;
      // Cleared only if the field still holds what was added, so later typing stays.
      setText((current) => textAfterSend(current, sent));
      reset();
    } catch (caught) {
      if (mounted.current) setFailure(failureText("Add", caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setAdding(false);
    }
  }, [actions, room.id, text, to, reset, mounted]);
  const done = room.todos.filter((post) => post.state === "done").length;
  // The lobby's tasks are the to-dos; what is left of its posts are notes, oldest first.
  const notes = useMemo(() => room.posts.filter((post) => post.kind === "note"), [room.posts]);
  if (picking) {
    return (
      <AgentPicker
        rooms={rooms}
        roomId={room.id}
        value={to}
        onChoose={choose}
        onBack={back}
        styles={styles}
      />
    );
  }
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetField}>
        <View style={styles.boardTitleRow}>
          <View style={styles.rowBody}>
            <TextInput
              accessibilityLabel="Add a to-do"
              value={text}
              onChangeText={setText}
              onSubmitEditing={add}
              // Enter adds and the focus stays for the next to-do. react-native-web reads only
              // blurOnSubmit; native reads submitBehavior.
              submitBehavior="submit"
              blurOnSubmit={false}
              placeholder="Add a to-do"
              placeholderTextColor={styles.placeholderColor}
              maxLength={POST_TEXT_MAX}
              style={styles.fieldInput}
            />
          </View>
          <ActionButton
            label="Add"
            pendingLabel="Adding..."
            onPress={add}
            disabled={adding || text.trim().length === 0}
            styles={styles}
            primary
          />
        </View>
        {failure === null ? null : (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {failure}
          </Text>
        )}
      </View>
      <WakeField
        id={fieldId}
        to={to}
        rooms={rooms}
        wakesPaused={wakesPaused}
        onOpen={open}
        styles={styles}
      />
      <View style={styles.boardPosts}>
        <TodoHeading board={room.id} done={done} actions={actions} styles={styles} />
        {room.todos.length === 0 ? <Text style={styles.muted}>No to-dos</Text> : null}
        {room.todos.map((post) => (
          <TodoRow key={post.id} post={post} name={name} actions={actions} styles={styles} />
        ))}
      </View>
      {notes.length > 0 ? (
        <View style={styles.boardPosts}>
          <Text style={styles.sheetLabel}>Notes</Text>
          {notes.map((post) => (
            <PostWithActions
              key={post.id}
              post={post}
              name={name}
              actions={actions}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.boardPosts}>
        <Text style={styles.sheetLabel}>Agent tasks</Text>
        {agentTasks.length === 0 ? <Text style={styles.muted}>No agent tasks</Text> : null}
        {agentTasks.map((group) => (
          <TaskGroup key={group.agentId} group={group} name={name} styles={styles} />
        ))}
      </View>
    </View>
  );
}
