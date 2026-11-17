import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView as NativeScrollView,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { CHAT_TEXT_MAX, chatRpc, type ChatMessage, type ChatRequest } from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { ActionButton, failureText } from "./action-button.js";
import { loadProblem } from "./activity-panel.js";
import {
  CHAT_EMPTY,
  CHAT_RECALLED,
  REACTION_CHOICES,
  RECALL_MS,
  SHOW_MORE_LINES,
  STICKERS,
  avatarOf,
  canRecall,
  counterText,
  enterSends,
  isLong,
  isYours,
  mentionAt,
  mentionOptions,
  pollRows,
  putMention,
  reactionRows,
  remindState,
  shows,
  timeLabel,
  typingText,
  type MentionOption,
} from "./chat-text.js";
import { markChatSeen } from "./chat-seen.js";
import { linkOpenSession } from "./office-link.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useOffice } from "./use-office.js";

type Navigation = PluginScreenProps["navigation"];

/** Sends a request to the chat; false when it failed, and the error is then under the box. */
type Run = (input: ChatRequest) => Promise<boolean>;

/** On the web a key press carries the browser's keyboard event. */
type KeyPress = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }
>;

/** How close to its end the list still counts as at the bottom. */
const BOTTOM_SLACK = 24;

/**
 * The box after a send went through: what was sent leaves the start of it, and what was typed
 * while the call ran stays. A box changed at its start is left as it is.
 */
function textAfterSend(current: string, sent: string): string {
  const rest = current.trimStart();
  return rest.startsWith(sent) ? rest.slice(sent.length).trimStart() : current;
}

/** A message's words where it is quoted: a sticker's own words, else its text. */
function quotedText(message: ChatMessage): string {
  return message.kind === "sticker" ? (STICKERS[message.sticker ?? 0] ?? "") : message.text;
}

/**
 * What a message's buttons tell it. A pressable row loses its hover to a pressable inside it
 * (docs/hover.md), so the buttons keep the row's actions shown while one has the pointer or the
 * focus.
 */
interface Keep {
  hover(on: boolean): void;
  focus(on: boolean): void;
}

interface ChatButtonProps<Value> {
  label: string;
  value: Value;
  onPress(value: Value): void;
  styles: OfficeStyles;
  /** A toggle says whether it is on: pressed for a button, checked for a radio. */
  on?: boolean;
  radio?: boolean;
  keep?: Keep;
  /** A message's small pill unless given, outlined while on. */
  style?: ViewStyle;
  /** The label in the pill unless given. */
  children?: ReactNode;
}

/** A pill in the chat: the view switch's hover and press fill over its style. */
function ChatButton<Value>({
  label,
  value,
  onPress,
  styles,
  on,
  radio = false,
  keep,
  style,
  children,
}: ChatButtonProps<Value>) {
  const press = useCallback(() => onPress(value), [onPress, value]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => {
    setHovered(true);
    keep?.hover(true);
  }, [keep]);
  const hoverOut = useCallback(() => {
    setHovered(false);
    keep?.hover(false);
  }, [keep]);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const focus = useCallback(() => keep?.focus(true), [keep]);
  const blur = useCallback(() => keep?.focus(false), [keep]);
  return (
    <Pressable
      accessibilityRole={radio ? "radio" : "button"}
      accessibilityLabel={label}
      aria-pressed={radio ? undefined : on}
      aria-checked={radio ? on : undefined}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      onFocus={focus}
      onBlur={blur}
      style={style ?? (on === true ? styles.chatReactionOn : styles.chatReaction)}
    >
      {hovered || pressed ? <View style={styles.segmentHoverFill} /> : null}
      {children ?? <Text style={styles.chatMeta}>{label}</Text>}
    </Pressable>
  );
}

/** The sender's initials on a disc in their floor colour; the name beside it says who it is. */
function Avatar({
  initials,
  color,
  styles,
}: {
  initials: string;
  color: string;
  styles: OfficeStyles;
}) {
  const disc = useMemo(() => ({ ...styles.chatAvatar, backgroundColor: color }), [styles, color]);
  return (
    <View aria-hidden style={disc}>
      <Text style={styles.chatAvatarText}>{initials}</Text>
    </View>
  );
}

function Quote({ name, text, styles }: { name: string; text: string; styles: OfficeStyles }) {
  return (
    <View style={styles.chatQuote}>
      <Text style={styles.chatName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.chatMeta} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

interface BodyProps {
  message: ChatMessage;
  /** The sender is an agent on the floor, so its session can be opened. */
  onFloor: boolean;
  navigation: Navigation;
  run: Run;
  keep: Keep;
  styles: OfficeStyles;
}

/** Words, clipped at eight lines until Show more; an agent's have Open session under them. */
function TextBody({ message, onFloor, navigation, keep, styles }: BodyProps) {
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const { from } = message;
  const open = useCallback(() => {
    if (from !== undefined) linkOpenSession(from, navigation);
  }, [from, navigation]);
  const clipped = !expanded && isLong(message.text);
  const openable = onFloor && !isYours(message);
  return (
    <>
      <Text style={styles.chatText} numberOfLines={clipped ? SHOW_MORE_LINES : 0}>
        {message.text}
      </Text>
      {clipped || openable ? (
        <View style={styles.chatActions}>
          {clipped ? (
            <ChatButton
              label="Show more"
              value="more"
              onPress={expand}
              keep={keep}
              styles={styles}
            />
          ) : null}
          {openable ? (
            <ChatButton
              label="Open session"
              value="open"
              onPress={open}
              keep={keep}
              styles={styles}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

/** The question, then each option with its count; yours is checked, and a press votes. */
function PollBody({ message, run, keep, styles }: BodyProps) {
  const { id } = message;
  const vote = useCallback((index: number) => void run({ op: "vote", id, index }), [run, id]);
  return (
    <>
      <Text style={styles.chatText}>{message.text}</Text>
      <View role="radiogroup" aria-label={message.text} style={styles.pickerRows}>
        {pollRows(message).map((option) => (
          <ChatButton
            key={option.index}
            label={`${option.text}, ${option.count}`}
            value={option.index}
            onPress={vote}
            radio
            on={option.mine}
            keep={keep}
            styles={styles}
          />
        ))}
      </View>
    </>
  );
}

/** The reminder's title, its time and who is going; Going and Not going until it has come round. */
function RemindBody({ message, run, keep, styles }: BodyProps) {
  const { id } = message;
  const answer = useCallback((yes: boolean) => void run({ op: "rsvp", id, yes }), [run, id]);
  const state = remindState(message);
  if (state === null) return null;
  return (
    <>
      <Text style={styles.chatText}>{message.text}</Text>
      <Text style={styles.chatMeta}>
        {state.when} · {state.going} going
      </Text>
      {state.done ? null : (
        <View style={styles.chatActions}>
          <ChatButton
            label="Going"
            value
            onPress={answer}
            on={state.yours === "yes"}
            keep={keep}
            styles={styles}
          />
          <ChatButton
            label="Not going"
            value={false}
            onPress={answer}
            on={state.yours === "no"}
            keep={keep}
            styles={styles}
          />
        </View>
      )}
    </>
  );
}

function Body(props: BodyProps) {
  const { message, styles } = props;
  if (message.recalled === true) return <Text style={styles.chatMeta}>{CHAT_RECALLED}</Text>;
  switch (message.kind) {
    case "sticker":
      return (
        <View style={styles.chatChip}>
          <Text style={styles.chatText}>{STICKERS[message.sticker ?? 0] ?? ""}</Text>
        </View>
      );
    case "poll":
      return <PollBody {...props} />;
    case "remind":
      return <RemindBody {...props} />;
    default:
      return <TextBody {...props} />;
  }
}

/** Each reaction with its count, yours pressed; a press sends that emoji, which takes yours back. */
function Reactions({ message, run, keep, styles }: BodyProps) {
  const { id } = message;
  const react = useCallback((emoji: string) => void run({ op: "react", id, emoji }), [run, id]);
  const rows = reactionRows(message);
  if (rows.length === 0) return null;
  return (
    <View style={styles.chatReactions}>
      {rows.map((reaction) => (
        <ChatButton
          key={reaction.emoji}
          label={`${reaction.emoji} ${reaction.count}`}
          value={reaction.emoji}
          onPress={react}
          on={reaction.mine}
          keep={keep}
          styles={styles}
        />
      ))}
    </View>
  );
}

interface ActionsProps extends BodyProps {
  shown: boolean;
  recallable: boolean;
  picking: boolean;
  onPicking(): void;
  onReply(message: ChatMessage): void;
}

/** React, Reply and Recall; React opens the six reactions under them. */
function Actions({
  message,
  run,
  keep,
  styles,
  shown,
  recallable,
  picking,
  onPicking,
  onReply,
}: ActionsProps) {
  const { id } = message;
  const reply = useCallback(() => onReply(message), [onReply, message]);
  const recall = useCallback(() => void run({ op: "recall", id }), [run, id]);
  const choose = useCallback(
    (emoji: string) => {
      onPicking();
      void run({ op: "react", id, emoji });
    },
    [onPicking, run, id],
  );
  return (
    <>
      <View style={shown ? styles.chatActions : styles.chatActionsHidden}>
        <ChatButton
          label="React"
          value="react"
          onPress={onPicking}
          on={picking}
          keep={keep}
          styles={styles}
        />
        <ChatButton label="Reply" value="reply" onPress={reply} keep={keep} styles={styles} />
        {recallable ? (
          <ChatButton label="Recall" value="recall" onPress={recall} keep={keep} styles={styles} />
        ) : null}
      </View>
      {picking ? (
        <View style={styles.chatReactions}>
          {REACTION_CHOICES.map((emoji) => (
            <ChatButton
              key={emoji}
              label={emoji}
              value={emoji}
              onPress={choose}
              keep={keep}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/** Whether your message can still be recalled; it turns false when the server's limit passes. */
function useRecallable(message: ChatMessage): boolean {
  const recallable = canRecall(message, Date.now());
  const [, expire] = useReducer((count: number) => count + 1, 0);
  const { at } = message;
  useEffect(() => {
    if (!recallable) return undefined;
    const timer = setTimeout(expire, at + RECALL_MS - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [recallable, at]);
  return recallable;
}

interface ChatRowProps {
  message: ChatMessage;
  onFloor: boolean;
  /** Nothing to hover with: a phone, or the compact layout. */
  always: boolean;
  navigation: Navigation;
  run: Run;
  onReply(message: ChatMessage): void;
  styles: OfficeStyles;
}

/**
 * One message: an agent's on the left with its avatar, name and time, yours on the right. Its
 * actions show on hover and focus on a wide web screen, and always on a phone.
 */
const ChatRow = memo(function ChatRow({
  message,
  onFloor,
  always,
  navigation,
  run,
  onReply,
  styles,
}: ChatRowProps) {
  const mine = isYours(message);
  const avatar = avatarOf(message);
  const time = timeLabel(message.at, Date.now());
  const recallable = useRecallable(message);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [inner, setInner] = useState(false);
  const [focused, setFocused] = useState(false);
  const keep = useMemo<Keep>(() => ({ hover: setInner, focus: setFocused }), []);
  const [picking, setPicking] = useState(false);
  const togglePicking = useCallback(() => setPicking((open) => !open), []);
  const body: BodyProps = { message, onFloor, navigation, run, keep, styles };
  return (
    <Pressable
      testID={`chat-${message.id}`}
      tabIndex={-1}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={mine ? styles.chatRowMine : styles.chatRow}
    >
      {avatar === null ? null : (
        <Avatar initials={avatar.initials} color={avatar.color} styles={styles} />
      )}
      <View style={mine ? styles.chatBubbleMine : styles.chatBubble}>
        {mine ? null : (
          <View style={styles.boardHeading}>
            <Text style={styles.chatName} numberOfLines={1}>
              {message.name ?? ""}
            </Text>
            <Text style={styles.chatMeta}>{time}</Text>
          </View>
        )}
        {message.reply ? (
          <Quote name={message.reply.name} text={message.reply.text} styles={styles} />
        ) : null}
        <Body {...body} />
        {mine ? <Text style={styles.chatMeta}>{time}</Text> : null}
        {message.recalled === true ? null : <Reactions {...body} />}
        {message.recalled === true ? null : (
          <Actions
            {...body}
            shown={always || hovered || inner || focused || picking}
            recallable={recallable}
            picking={picking}
            onPicking={togglePicking}
            onReply={onReply}
          />
        )}
      </View>
    </Pressable>
  );
});

interface MessagesProps {
  messages: readonly ChatMessage[];
  /** The agents on the floor. */
  agents: ReadonlyMap<string, unknown>;
  problem: string | null;
  always: boolean;
  navigation: Navigation;
  run: Run;
  onReply(message: ChatMessage): void;
  styles: OfficeStyles;
}

/** The conversation, oldest first; a state that cannot load says so in its place. */
function Messages({
  messages,
  agents,
  problem,
  always,
  navigation,
  run,
  onReply,
  styles,
}: MessagesProps) {
  if (problem !== null) {
    return (
      <View style={styles.banner}>
        <Text accessibilityRole="alert" style={styles.bannerText}>
          {problem}
        </Text>
      </View>
    );
  }
  if (messages.length === 0) return <Text style={styles.muted}>{CHAT_EMPTY}</Text>;
  return messages.map((message) =>
    message.kind === "sys" ? (
      <Text key={message.id} testID={`chat-${message.id}`} style={styles.chatSystem}>
        {message.text}
      </Text>
    ) : (
      <ChatRow
        key={message.id}
        message={message}
        onFloor={message.from !== undefined && agents.has(message.from)}
        always={always}
        navigation={navigation}
        run={run}
        onReply={onReply}
        styles={styles}
      />
    ),
  );
}

interface ReplyBarProps {
  message: ChatMessage;
  onClose(): void;
  iconSize: number;
  color: string;
  styles: OfficeStyles;
}

/** The message your next one answers, above the box. */
function ReplyBar({ message, onClose, iconSize, color, styles }: ReplyBarProps) {
  return (
    <View style={styles.boardTitleRow}>
      <Quote name={message.name ?? ""} text={quotedText(message)} styles={styles} />
      <ChatButton
        label="Cancel reply"
        value="close"
        onPress={onClose}
        style={styles.segment}
        styles={styles}
      >
        <Icon name="X" size={iconSize} color={color} />
      </ChatButton>
    </View>
  );
}

interface MentionListProps {
  options: readonly MentionOption[];
  onPick(name: string): void;
  styles: OfficeStyles;
}

/** The team the words after `@` find, under the box. */
function MentionList({ options, onPick, styles }: MentionListProps) {
  return (
    <ScrollView style={styles.chatMentions} keyboardShouldPersistTaps="handled">
      {options.map((option) => (
        <ChatButton
          key={option.id}
          label={`${option.name}, ${option.room}`}
          value={option.name}
          onPress={onPick}
          style={styles.pickerRow}
          styles={styles}
        >
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {option.name}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {option.room}
            </Text>
          </View>
        </ChatButton>
      ))}
    </ScrollView>
  );
}

function StickerTray({ onPick, styles }: { onPick(index: number): void; styles: OfficeStyles }) {
  return (
    <View style={styles.chips}>
      {STICKERS.map((words, index) => (
        <ChatButton
          key={words}
          label={words}
          value={index}
          onPress={onPick}
          style={styles.chatChip}
          styles={styles}
        >
          <Text style={styles.chatText}>{words}</Text>
        </ChatButton>
      ))}
    </View>
  );
}

/**
 * The Chat screen, beside the floor or on its own route. Its own subscription to the office's
 * state brings the conversation; the chat is kept apart from the floor's state there.
 */
export function ChatPanel({ theme, layout, navigation }: PluginScreenProps) {
  // The side area always passes compact, which sizes every control for touch on its own.
  const styles = useOfficeStyles(theme, layout.compact, false);
  const { state, subscription, chat } = useOffice();
  const call = useRpc(chatRpc);
  const model = useMemo(() => buildOfficeModel(state), [state]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const all = chat?.messages;
  const messages = useMemo(() => (all ?? []).filter(shows), [all]);
  const problem = loadProblem(subscription);
  const web = layout.platform === "web";
  const always = layout.compact || !web;
  // The chat is seen up to its newest message while it is open.
  const newest = messages.at(-1)?.at ?? 0;
  useEffect(() => {
    if (newest > 0) markChatSeen(newest);
  }, [newest]);
  // Stays at the bottom while you are there.
  const atBottom = useRef(true);
  const scroller = useRef<NativeScrollView>(null);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    atBottom.current =
      contentSize.height - contentOffset.y - layoutMeasurement.height < BOTTOM_SLACK;
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (atBottom.current) scroller.current?.scrollToEnd({ animated: false });
  }, []);

  const run = useCallback(
    async (input: ChatRequest): Promise<boolean> => {
      try {
        const result = await call(input);
        if (!result.ok) throw new Error(result.error);
        setError(null);
        return true;
      } catch (failure) {
        setError(failureText("Send", failure));
        return false;
      }
    },
    [call],
  );
  // Enter and the Send button can both fire before the first send returns.
  const sending = useRef(false);
  const send = useCallback(async () => {
    const sent = text.trim();
    if (sent === "" || sending.current) return;
    sending.current = true;
    const ok = await run(
      replyTo === null
        ? { op: "send", text: sent }
        : { op: "send", text: sent, replyTo: replyTo.id },
    );
    sending.current = false;
    if (!ok) return;
    setText((current) => textAfterSend(current, sent));
    setReplyTo(null);
  }, [text, replyTo, run]);
  const sendSticker = useCallback(
    async (sticker: number) => {
      const ok = await run(
        replyTo === null ? { op: "send", sticker } : { op: "send", sticker, replyTo: replyTo.id },
      );
      if (!ok) return;
      setStickersOpen(false);
      setReplyTo(null);
    },
    [replyTo, run],
  );

  const options = useMemo(() => {
    const mention = mentionAt(text);
    return mention === null ? [] : mentionOptions(model, mention.query);
  }, [text, model]);
  const first = options[0];
  const pick = useCallback((name: string) => {
    setText((current) => {
      const mention = mentionAt(current);
      return mention === null ? current : putMention(current, mention, name);
    });
  }, []);
  const onKeyPress = useCallback(
    (event: KeyPress) => {
      // On a phone Enter is a new line, and the Send button sends. An IME's Enter picks a word.
      const { nativeEvent } = event;
      if (!web || nativeEvent.isComposing === true) return;
      const tab = nativeEvent.key === "Tab" && nativeEvent.shiftKey !== true;
      // While the @ list is open, Enter and Tab put the first name and do not send.
      if (first !== undefined && (tab || enterSends(nativeEvent))) {
        event.preventDefault();
        pick(first.name);
        return;
      }
      if (enterSends(nativeEvent)) {
        event.preventDefault();
        void send();
      }
    },
    [web, first, pick, send],
  );
  const toggleStickers = useCallback(() => setStickersOpen((open) => !open), []);
  const closeReply = useCallback(() => setReplyTo(null), []);
  const typing = typingText(chat?.typing ?? []);
  const counter = counterText(text.length);
  // The glyph at the app's icon sizes, as the header's buttons have it.
  const iconSize = layout.compact ? 20 : 16;
  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.chatList}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
      >
        <Messages
          messages={messages}
          agents={model.agents}
          problem={problem}
          always={always}
          navigation={navigation}
          run={run}
          onReply={setReplyTo}
          styles={styles}
        />
      </ScrollView>
      <Text style={styles.chatTyping}>{typing}</Text>
      <View style={styles.chatBox}>
        {replyTo === null ? null : (
          <ReplyBar
            message={replyTo}
            onClose={closeReply}
            iconSize={iconSize}
            color={theme.colors.foreground}
            styles={styles}
          />
        )}
        <TextInput
          accessibilityLabel="Message"
          value={text}
          onChangeText={setText}
          onKeyPress={onKeyPress}
          multiline
          maxLength={CHAT_TEXT_MAX}
          style={styles.input}
        />
        {options.length > 0 ? (
          <MentionList options={options} onPick={pick} styles={styles} />
        ) : null}
        {counter === null ? null : <Text style={styles.chatMeta}>{counter}</Text>}
        {error === null ? null : (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {error}
          </Text>
        )}
        <View style={styles.boardTitleRow}>
          <ChatButton
            label="Stickers"
            value="stickers"
            onPress={toggleStickers}
            on={stickersOpen}
            style={styles.segment}
            styles={styles}
          >
            <Icon name="Smile" size={iconSize} color={theme.colors.foreground} />
          </ChatButton>
          <ActionButton
            label="Send"
            pendingLabel="Sending..."
            onPress={send}
            disabled={text.trim() === ""}
            primary
            styles={styles}
          />
        </View>
        {stickersOpen ? <StickerTray onPick={sendSticker} styles={styles} /> : null}
      </View>
    </View>
  );
}
