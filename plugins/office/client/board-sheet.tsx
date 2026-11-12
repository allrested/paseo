import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  LOBBY,
  POST_TEXT_MAX,
  type OfficeAgent,
  type Post,
  type PostKind,
} from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { orderBoardPosts } from "./board-text.js";
import { agentTitle, type OfficeRoom } from "./model.js";
import { PostRow } from "./room-board.js";
import { listenForSpace } from "./scene/web-env.web.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

interface ChipProps {
  label: string;
  value: string;
  selected: boolean;
  onSelect(value: string): void;
  styles: OfficeStyles;
}

/** One choice of a set: a radio drawn as a chip. */
function Chip({ label, value, selected, onSelect, styles }: ChipProps) {
  const press = useCallback(() => onSelect(value), [onSelect, value]);
  // Enter presses any Pressable; Space, the key that picks a radio, only a button.
  const id = useId();
  useEffect(() => listenForSpace(id, press), [id, press]);
  return (
    <Pressable
      id={id}
      accessibilityRole="radio"
      aria-checked={selected}
      onPress={press}
      style={selected ? styles.chipSelected : styles.chip}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface PostActionsProps {
  post: Post;
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
}

function PostWithActions({ post, name, actions, styles }: PostActionsProps) {
  const done = useCallback(() => actions.markDone(post.id), [actions, post.id]);
  const remove = useCallback(() => actions.remove(post.id), [actions, post.id]);
  // A deleted post is gone for good, so Delete asks once more. The question moves the buttons
  // down a line: a second tap in the same place lands on the words, not on a button.
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  return (
    <View style={styles.boardPost}>
      <PostRow post={post} name={name} styles={styles} />
      {asking ? (
        <>
          <Text style={styles.sheetText}>Delete this post?</Text>
          <View style={styles.actions}>
            <ActionButton
              label="Delete"
              pendingLabel="Deleting..."
              onPress={remove}
              styles={styles}
            />
            <ActionButton label="Keep" pendingLabel="Keeping..." onPress={keep} styles={styles} />
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          {post.kind === "task" ? (
            <ActionButton
              label="Mark done"
              pendingLabel="Saving..."
              onPress={done}
              styles={styles}
            />
          ) : null}
          <ActionButton label="Delete" pendingLabel="Deleting..." onPress={ask} styles={styles} />
        </View>
      )}
    </View>
  );
}

const NOBODY = "";
const KINDS: readonly { kind: PostKind; label: string; hint: string }[] = [
  { kind: "task", label: "Task", hint: "What needs doing" },
  { kind: "note", label: "Note", hint: "What the room should know" },
];

interface SheetBodyProps {
  room: OfficeRoom;
  agents: readonly OfficeAgent[];
  name(author: string): string;
  actions: BoardActions;
  wakesPaused: boolean;
  styles: OfficeStyles;
}

function SheetBody({ room, agents, name, actions, wakesPaused, styles }: SheetBodyProps) {
  const [kind, setKind] = useState<PostKind>("task");
  const [text, setText] = useState("");
  const [to, setTo] = useState(NOBODY);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectKind = useCallback(
    (value: string) => setKind(value === "note" ? "note" : "task"),
    [],
  );
  // The room's own agents first: they are the usual addressees.
  const people = useMemo(() => {
    const own = agents.filter((agent) => (agent.workspaceId ?? LOBBY) === room.id);
    const others = agents.filter((agent) => (agent.workspaceId ?? LOBBY) !== room.id);
    return [...own, ...others];
  }, [agents, room.id]);
  const posts = useMemo(() => orderBoardPosts(room.posts), [room.posts]);
  const submit = useCallback(async () => {
    const sent = text.trim();
    await actions.post({ board: room.id, kind, text: sent, ...(to === NOBODY ? {} : { to }) });
    if (!mounted.current) return;
    // Cleared only if the box still holds what was posted, so later typing stays.
    setText((current) => textAfterSend(current, sent));
    setTo(NOBODY);
  }, [actions, room.id, kind, text, to]);
  const chosen = KINDS.find((option) => option.kind === kind) ?? KINDS[0];
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetField}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Kind of post" style={styles.chips}>
          {KINDS.map((option) => (
            <Chip
              key={option.kind}
              label={option.label}
              value={option.kind}
              selected={kind === option.kind}
              onSelect={selectKind}
              styles={styles}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel={chosen ? `${chosen.label} text` : undefined}
          value={text}
          onChangeText={setText}
          placeholder={chosen?.hint}
          placeholderTextColor={styles.placeholderColor}
          maxLength={POST_TEXT_MAX}
          multiline
          style={styles.input}
        />
      </View>
      <View style={styles.sheetField}>
        <Text style={styles.sheetLabel}>Wake an agent with it</Text>
        {/* One row that scrolls sideways, as the strip does: with many agents a wrapped list
            would push Post off the screen. The room's own agents come first. */}
        <View accessibilityRole="radiogroup" accessibilityLabel="Wake an agent with it">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            <Chip
              label="Nobody"
              value={NOBODY}
              selected={to === NOBODY}
              onSelect={setTo}
              styles={styles}
            />
            {people.map((agent) => (
              <Chip
                key={agent.id}
                label={agentTitle(agent)}
                value={agent.id}
                selected={to === agent.id}
                onSelect={setTo}
                styles={styles}
              />
            ))}
          </ScrollView>
        </View>
        {to !== NOBODY && wakesPaused ? (
          <Text style={styles.muted}>
            Wake agents is off. The agent gets this post when you turn it on.
          </Text>
        ) : null}
      </View>
      <ActionButton
        label="Post"
        pendingLabel="Posting..."
        onPress={submit}
        disabled={text.trim().length === 0}
        styles={styles}
        primary
      />
      <View style={styles.boardPosts}>
        {posts.length === 0 ? (
          <Text style={styles.muted}>No posts</Text>
        ) : (
          <Text style={styles.sheetLabel}>Posts</Text>
        )}
        {posts.map((post) => (
          <PostWithActions
            key={post.id}
            post={post}
            name={name}
            actions={actions}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

export interface BoardSheetProps {
  room: OfficeRoom | null;
  agents: readonly OfficeAgent[];
  name(author: string): string;
  actions: BoardActions;
  /** "Wake agents" is off: a post that names an agent waits. */
  wakesPaused: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/** Post a task or note, optionally waking an agent; mark a task done or delete a post. */
export function BoardSheet({
  room,
  agents,
  name,
  actions,
  wakesPaused,
  styles,
  onClose,
}: BoardSheetProps) {
  const change = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const title = room ? `${room.name} board` : "Board";
  return (
    <Modal title={title} open={room !== null} onOpenChange={change}>
      <Modal.Content>
        {room ? (
          <SheetBody
            key={room.id}
            room={room}
            agents={agents}
            name={name}
            actions={actions}
            wakesPaused={wakesPaused}
            styles={styles}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
