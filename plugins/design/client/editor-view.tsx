import { useCallback, useEffect, useId, useState } from "react";
import {
  Image,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useRpc, useSubscription, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  addCommentRpc,
  editorLinkRpc,
  viewSubscription,
  type FileRow,
  type ViewEvent,
} from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { IconButton } from "./controls.js";
import { tokensBanner, type Tokens } from "./model.js";
import { SendSheet } from "./send-sheet.js";
import type { DesignStyles } from "./styles.js";
import { tapToPicture } from "./tap.js";

type Picture = { uri: string; width: number; height: number } | "empty" | null;
type Thread = Extract<ViewEvent, { type: "threads" }>["threads"][number];
interface Point {
  x: number;
  y: number;
}

const IMAGE_SOURCE_CACHE = new Map<string, { uri: string }>();

/** One `source` object per picture, so the Image is not handed a new object every render. */
function sourceOf(uri: string): { uri: string } {
  let source = IMAGE_SOURCE_CACHE.get(uri);
  if (!source) {
    IMAGE_SOURCE_CACHE.clear();
    source = { uri };
    IMAGE_SOURCE_CACHE.set(uri, source);
  }
  return source;
}

/** The FigCraft editor in a frame on web, mounted into the view as the office mounts its canvas. */
function WebEditor(props: {
  fileId: string;
  workspaceId: string;
  attempt: number;
  styles: DesignStyles;
  onFailure(error: string): void;
}) {
  const { fileId, workspaceId, attempt, onFailure } = props;
  const editorLink = useRpc(editorLinkRpc);
  const containerId = useId();
  useEffect(() => {
    let frame: HTMLIFrameElement | null = null;
    let cancelled = false;
    void editorLink({ fileId, workspaceId }).then(
      (result) => {
        if (cancelled) return undefined;
        if (!result.ok) {
          onFailure(result.error);
          return undefined;
        }
        const container = document.getElementById(containerId);
        if (container === null) return undefined;
        frame = document.createElement("iframe");
        frame.src = result.url;
        frame.title = "FigCraft editor";
        frame.allow = "clipboard-read; clipboard-write";
        Object.assign(frame.style, {
          border: "0",
          width: "100%",
          height: "100%",
          display: "block",
        });
        container.appendChild(frame);
        return undefined;
      },
      (error: unknown) => {
        if (!cancelled) onFailure(String(error));
      },
    );
    return () => {
      cancelled = true;
      frame?.remove();
    };
  }, [attempt, containerId, editorLink, fileId, onFailure, workspaceId]);
  return <View id={containerId} style={props.styles.editorFrame} />;
}

function ThreadRow(props: { thread: Thread; styles: DesignStyles; onSend(text: string): void }) {
  const { thread, styles, onSend } = props;
  const send = useCallback(() => onSend(thread.preview), [onSend, thread.preview]);
  return (
    <View style={styles.thread}>
      <View style={styles.threadBody}>
        <Text style={styles.threadAuthor} numberOfLines={1}>
          {thread.author}
        </Text>
        <Text style={styles.threadText}>{thread.preview}</Text>
      </View>
      <ActionButton label="Send" pendingLabel="Send" styles={styles} onPress={send} />
    </View>
  );
}

function PictureContent(props: { picture: Picture; styles: DesignStyles }) {
  const { picture, styles } = props;
  if (picture === null) return <Text style={styles.emptyTitle}>Drawing the design...</Text>;
  if (picture === "empty") return <Text style={styles.emptyTitle}>Nothing on this page yet</Text>;
  return <Image source={sourceOf(picture.uri)} style={styles.picture} resizeMode="contain" />;
}

/** The phone's view: the bridge's picture of the page, tap to comment, open threads below. */
function PhoneView(props: {
  name: string;
  picture: Picture;
  threads: Thread[];
  styles: DesignStyles;
  onComment(point: Point): void;
  onSend(text: string): void;
}) {
  const { picture, styles, onComment } = props;
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const measure = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame({ width, height });
  }, []);
  const tap = useCallback(
    (event: GestureResponderEvent) => {
      if (picture === null || picture === "empty") return;
      // Native gives locationX; a click on web gives offsetX. Anything else is not a spot.
      const at = event.nativeEvent as {
        locationX?: number;
        locationY?: number;
        offsetX?: number;
        offsetY?: number;
      };
      const x = at.locationX ?? at.offsetX;
      const y = at.locationY ?? at.offsetY;
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const point = tapToPicture({ x, y }, frame, picture);
      if (point !== null) onComment(point);
    },
    [frame, onComment, picture],
  );
  return (
    <>
      <Pressable
        style={styles.pictureFrame}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${props.name}. Tap a spot to comment on it`}
        accessibilityHint="Opens a comment at that spot"
        onLayout={measure}
        onPress={tap}
      >
        <PictureContent picture={picture} styles={styles} />
      </Pressable>
      <Text style={styles.pictureHint}>Tap the design to comment. Edit it on a computer</Text>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        Open comments
      </Text>
      <ScrollView style={styles.threads}>
        {props.threads.length === 0 ? <Text style={styles.threadsEmpty}>None</Text> : null}
        {props.threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} styles={styles} onSend={props.onSend} />
        ))}
      </ScrollView>
    </>
  );
}

function CommentSheet(props: {
  fileId: string;
  point: Point | null;
  styles: DesignStyles;
  onClose(): void;
}) {
  const { fileId, point, styles, onClose } = props;
  const addComment = useRpc(addCommentRpc);
  const [text, setText] = useState("");
  const submit = useCallback(async () => {
    if (point === null) return;
    const result = await addComment({ fileId, x: point.x, y: point.y, text });
    if (!result.ok) throw new Error(result.error);
    setText("");
    onClose();
  }, [addComment, fileId, onClose, point, text]);
  const openChange = useCallback((open: boolean) => !open && onClose(), [onClose]);
  return (
    <Modal title="Add comment" open={point !== null} onOpenChange={openChange}>
      <Modal.Content>
        <View style={styles.sheet}>
          <TextInput
            accessibilityLabel="Comment text"
            value={text}
            onChangeText={setText}
            placeholder="What should change here?"
            placeholderTextColor={styles.placeholderColor}
            multiline
            autoFocus
            maxLength={2000}
            style={styles.inputMultiline}
          />
          <View style={styles.sheetActions}>
            <ActionButton
              label="Comment"
              pendingLabel="Commenting..."
              primary
              disabled={text.trim() === ""}
              styles={styles}
              onPress={submit}
            />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function Failed(props: { problem: string; styles: DesignStyles; retry(): void }) {
  const { styles } = props;
  return (
    <View style={styles.emptyBlock}>
      <Text style={styles.emptyTitle}>Unable to open the design</Text>
      <Text style={styles.emptyHint}>{props.problem}</Text>
      <ActionButton
        label="Try again"
        pendingLabel="Opening..."
        styles={styles}
        onPress={props.retry}
      />
    </View>
  );
}

export function EditorView(
  props: PluginWorkspacePanelProps & { file: FileRow; styles: DesignStyles; onClose(): void },
) {
  const { file, workspaceId, layout, styles } = props;
  // FigCraft's editor needs a wide screen; a phone, in the app or a browser, views and comments.
  const web = layout.platform === "web" && !layout.compact;
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [picture, setPicture] = useState<Picture>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [written, setWritten] = useState(false);
  const [draft, setDraft] = useState<Point | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);

  const onEvent = useCallback((event: ViewEvent) => {
    if (event.type === "status") setFailure(event.status === "failed" ? event.error : null);
    if (event.type === "tokens") setTokens(event.tokens);
    if (event.type === "tokens-written") setWritten(true);
    if (event.type === "threads") setThreads(event.threads);
    if (event.type === "picture") {
      const uri = event.uri;
      if (uri === null) {
        setPicture("empty");
        return;
      }
      Image.getSize(uri, (width, height) => setPicture({ uri, width, height }));
    }
  }, []);
  const subscription = useSubscription(
    viewSubscription,
    { fileId: file.id, workspaceId, pictures: !web, attempt },
    onEvent,
  );
  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);
  const sendSelection = useCallback(() => setSendNote(""), []);
  const closeSend = useCallback(() => setSendNote(null), []);
  const closeComment = useCallback(() => setDraft(null), []);

  const lost =
    subscription.status === "error"
      ? `Lost the design's connection: ${subscription.error.message}`
      : null;
  const problem = failure ?? lost;
  const banner = tokensBanner(tokens, written);

  let body;
  if (problem !== null) body = <Failed problem={problem} styles={styles} retry={retry} />;
  else if (web) {
    body = (
      <WebEditor
        fileId={file.id}
        workspaceId={workspaceId}
        attempt={attempt}
        styles={styles}
        onFailure={setFailure}
      />
    );
  } else {
    body = (
      <PhoneView
        name={file.name}
        picture={picture}
        threads={threads}
        styles={styles}
        onComment={setDraft}
        onSend={setSendNote}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={web ? styles.editorHeader : styles.header}>
        <View style={styles.headerLead}>
          <IconButton
            label="Back to designs"
            icon="ChevronLeft"
            styles={styles}
            onPress={props.onClose}
          />
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {file.name}
          </Text>
        </View>
        {web && problem === null ? (
          <ActionButton
            label="Send to agent"
            pendingLabel="Send to agent"
            primary
            styles={styles}
            onPress={sendSelection}
          />
        ) : null}
      </View>
      {banner ? (
        <View style={web ? styles.editorBanner : styles.banner}>
          <Text style={styles.bannerText[banner.tone]}>{banner.text}</Text>
        </View>
      ) : null}
      {body}
      <CommentSheet fileId={file.id} point={draft} styles={styles} onClose={closeComment} />
      <SendSheet
        note={sendNote}
        onClose={closeSend}
        workspaceId={workspaceId}
        file={file}
        styles={styles}
      />
    </View>
  );
}
