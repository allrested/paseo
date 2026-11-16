import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { POST_TEXT_MAX, type Post, type PostKind } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { AgentPicker } from "./agent-picker.js";
import { NOBODY, choiceLabel, closeStep, keptChoice } from "./agent-picker-text.js";
import { orderBoardPosts } from "./board-text.js";
import type { OfficeRoom } from "./model.js";
import { PostRow } from "./room-board.js";
import { focusById, listenForSpace } from "./web-env.web.js";
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
export function Chip({ label, value, selected, onSelect, styles }: ChipProps) {
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

const KINDS: readonly { kind: PostKind; label: string; hint: string }[] = [
  { kind: "task", label: "Task", hint: "What needs doing" },
  { kind: "note", label: "Note", hint: "What the room should know" },
];

interface ChoiceFieldProps {
  id: string;
  /** What the row chooses. */
  label: string;
  /** The choice now. */
  value: string;
  onOpen(): void;
  styles: OfficeStyles;
}

/** A form's row that opens a page: what it chooses, the choice, and a chevron. */
function ChoiceField({ id, label, value, onOpen, styles }: ChoiceFieldProps) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  return (
    <Pressable
      id={id}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onOpen}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.pickerField}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      <View style={styles.pickerFieldBody}>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sheetText} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name="ChevronRight" size={16} color={styles.iconColor} />
    </Pressable>
  );
}

interface SheetBodyProps {
  room: OfficeRoom;
  rooms: readonly OfficeRoom[];
  name(author: string): string;
  actions: BoardActions;
  wakesPaused: boolean;
  /** The page that chooses the agent shows, not the form. */
  picking: boolean;
  onPicking(picking: boolean): void;
  styles: OfficeStyles;
}

function SheetBody({
  room,
  rooms,
  name,
  actions,
  wakesPaused,
  picking,
  onPicking,
  styles,
}: SheetBodyProps) {
  const [kind, setKind] = useState<PostKind>("task");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(NOBODY);
  // An agent that left the office cannot be woken: the choice is nobody again.
  const to = keptChoice(picked, rooms);
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
  const posts = useMemo(() => orderBoardPosts(room.posts), [room.posts]);
  const submit = useCallback(async () => {
    const sent = text.trim();
    await actions.post({ board: room.id, kind, text: sent, ...(to === NOBODY ? {} : { to }) });
    if (!mounted.current) return;
    // Cleared only if the box still holds what was posted, so later typing stays.
    setText((current) => textAfterSend(current, sent));
    setPicked(NOBODY);
  }, [actions, room.id, kind, text, to]);
  // Back from the page, the pressed row is gone: the focus returns to the row that opened it.
  const fieldId = useId();
  const wasPicking = useRef(false);
  useEffect(() => {
    if (picking) wasPicking.current = true;
    else if (wasPicking.current) focusById(fieldId);
  }, [picking, fieldId]);
  const openPage = useCallback(() => onPicking(true), [onPicking]);
  const back = useCallback(() => onPicking(false), [onPicking]);
  const choose = useCallback(
    (value: string) => {
      setPicked(value);
      onPicking(false);
    },
    [onPicking],
  );
  const chosen = KINDS.find((option) => option.kind === kind) ?? KINDS[0];
  // The form's state is kept here while the page shows, so the text typed is there on return.
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
        <ChoiceField
          id={fieldId}
          label="Wake an agent with it"
          value={choiceLabel(to, rooms)}
          onOpen={openPage}
          styles={styles}
        />
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
  /** Every room of the office: the agents a post can wake, and where each one sits. */
  rooms: readonly OfficeRoom[];
  name(author: string): string;
  actions: BoardActions;
  /** "Wake agents" is off: a post that names an agent waits. */
  wakesPaused: boolean;
  /**
   * The host's sheet has already left when it reports a close (a phone's, swiped away, or a
   * tablet's, dismissed by Back), so a close from the page closes the sheet.
   */
  sheetLeavesFirst: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/** Post a task or note, optionally waking an agent; mark a task done or delete a post. */
export function BoardSheet({
  room,
  rooms,
  name,
  actions,
  wakesPaused,
  sheetLeavesFirst,
  styles,
  onClose,
}: BoardSheetProps) {
  const [picking, setPicking] = useState(false);
  // Another room's sheet, and a sheet opened again, start on the form.
  const roomId = room?.id ?? null;
  useEffect(() => {
    setPicking(false);
  }, [roomId]);
  const change = useCallback(
    (open: boolean) => {
      if (open) return;
      if (closeStep(picking, sheetLeavesFirst) === "back") setPicking(false);
      else onClose();
    },
    [sheetLeavesFirst, onClose, picking],
  );
  const board = room ? `${room.name} board` : "Board";
  return (
    <Modal title={picking ? "Wake an agent" : board} open={room !== null} onOpenChange={change}>
      <Modal.Content>
        {room ? (
          <SheetBody
            key={room.id}
            room={room}
            rooms={rooms}
            name={name}
            actions={actions}
            wakesPaused={wakesPaused}
            picking={picking}
            onPicking={setPicking}
            styles={styles}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
