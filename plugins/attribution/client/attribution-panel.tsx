import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Pressable,
  Text,
  View,
  type FlatList as NativeFlatList,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useAgent, useTabState, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, Loading } from "@getpaseo/plugin/client/ui";
import { z } from "zod";
import type { Author, Mark, TrackedFile, Turn } from "../shared/contracts.js";
import { hasTouchScreen } from "./device.js";
import {
  agentName,
  agoLabel,
  filesLabel,
  legendOf,
  linesLabel,
  markAt,
  rangeLabel,
  rowsOf,
  splitPath,
  statusLabel,
  summaryLabel,
  whenLabel,
  type LegendAgent,
  type LineRow,
  type ReadyFile,
} from "./model.js";
import { useAttributionStyles, type AttributionStyles } from "./styles.js";
import { useFile, useFiles } from "./use-attribution.js";

/** What a tab remembers: the file it shows, or null for the list. */
const TabState = z.object({ path: z.string().nullable() });
const NO_FILE = { path: null };

type OpenAgent = (input: { agentId: string }) => void;

/** react-native-web adds `hovered` to a Pressable's state; native has no pointer to hover with. */
type PressState = PressableStateCallbackType & { hovered?: boolean };
const lit = ({ pressed, hovered }: PressState) => pressed || hovered === true;

const titleOf = (agent: { title: string | null }) => ({ title: agent.title });

/** The agent's name now, or the one its lines were recorded under once it is gone. */
function useAgentName(agent: Pick<Author, "id" | "title">): { name: string; open: boolean } {
  const live = useAgent(agent.id, titleOf);
  return { name: live?.title?.trim() || agentName(agent), open: live !== null };
}

interface MessageProps {
  title: string;
  detail?: string;
  failed?: boolean;
  styles: AttributionStyles;
  /** A button under the words. */
  action?: { label: string; onPress(): void };
}

function Message({ title, detail, failed = false, styles, action }: MessageProps) {
  const button = useCallback(
    (state: PressState) => (lit(state) ? styles.buttonPressed : styles.button),
    [styles],
  );
  return (
    <View style={styles.message}>
      <Text accessibilityRole={failed ? "alert" : undefined} style={styles.messageTitle}>
        {title}
      </Text>
      {detail ? <Text style={failed ? styles.danger : styles.muted}>{detail}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" style={button}>
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface IconButtonProps {
  icon: string;
  label: string;
  styles: AttributionStyles;
  onPress(): void;
  testID?: string;
}

function IconButton({ icon, label, styles, onPress, testID }: IconButtonProps) {
  const style = useCallback(
    (state: PressState) => (lit(state) ? styles.iconButtonPressed : styles.iconButton),
    [styles],
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={style}
      testID={testID}
    >
      <Icon name={icon} size={styles.iconSize} color={styles.iconColor} />
    </Pressable>
  );
}

interface BarProps {
  title: string;
  subtitle: string;
  styles: AttributionStyles;
  onBack?: () => void;
  onRefresh(): void;
}

function Bar({ title, subtitle, styles, onBack, onRefresh }: BarProps) {
  return (
    <View style={styles.bar}>
      {onBack ? (
        <IconButton
          icon="ArrowLeft"
          label="Back to the files"
          styles={styles}
          onPress={onBack}
          testID="attribution-back"
        />
      ) : null}
      <View style={styles.barText}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="head">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <IconButton
        icon="RefreshCw"
        label="Read again"
        styles={styles}
        onPress={onRefresh}
        testID="attribution-refresh"
      />
    </View>
  );
}

interface FileRowProps {
  file: TrackedFile;
  now: number;
  styles: AttributionStyles;
  onOpen(path: string): void;
}

const FileRow = memo(function FileRow({ file, now, styles, onOpen }: FileRowProps) {
  const { name, folder } = splitPath(file.path);
  const [first, ...rest] = file.agents;
  const latest = useAgentName(first ?? { id: "", title: null });
  const agents = rest.length === 0 ? latest.name : `${latest.name} +${rest.length}`;
  const open = useCallback(() => onOpen(file.path), [file.path, onOpen]);
  const style = useCallback(
    (state: PressState) => (lit(state) ? styles.filePressed : styles.file),
    [styles],
  );
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${file.path}, changed by ${agents}, ${agoLabel(file.at, now)}`}
      style={style}
      testID="attribution-file"
    >
      <View style={styles.fileMain}>
        <Text style={styles.fileName} numberOfLines={1}>
          {name}
        </Text>
        {folder ? (
          <Text style={styles.fileFolder} numberOfLines={1} ellipsizeMode="head">
            {folder}
          </Text>
        ) : null}
      </View>
      <View style={styles.fileSide}>
        <Text style={styles.fileAgents} numberOfLines={1}>
          {agents}
        </Text>
        <Text style={styles.fileWhen} numberOfLines={1}>
          {agoLabel(file.at, now)}
        </Text>
      </View>
    </Pressable>
  );
});

const fileKey = (file: TrackedFile) => file.path;
const NO_FILES: TrackedFile[] = [];

interface FilesViewProps {
  workspaceId: string;
  styles: AttributionStyles;
  onOpen(path: string): void;
}

function FilesView({ workspaceId, styles, onOpen }: FilesViewProps) {
  const [files, reload] = useFiles(workspaceId);
  // The clock is read once per answer: the rows' ages are as of the answer.
  const { tracked, now } = useMemo(
    () => ({
      tracked:
        files.status === "ready" && files.value.status === "ready" ? files.value.files : NO_FILES,
      now: Date.now(),
    }),
    [files],
  );
  const renderFile = useCallback(
    ({ item }: { item: TrackedFile }) => (
      <FileRow file={item} now={now} styles={styles} onOpen={onOpen} />
    ),
    [now, styles, onOpen],
  );
  const retry = useMemo(() => ({ label: "Try again", onPress: reload }), [reload]);
  let body;
  if (files.status === "loading") {
    body = <Loading />;
  } else if (files.status === "error") {
    body = (
      <Message
        title="The files could not be read"
        detail={files.message}
        failed
        styles={styles}
        action={retry}
      />
    );
  } else if (files.value.status === "no_checkout") {
    body = (
      <Message
        title="Nothing is tracked here"
        detail="This workspace's folder is not a Git checkout, so there is no record of who wrote its lines."
        styles={styles}
      />
    );
  } else if (tracked.length === 0) {
    body = (
      <Message
        title="No agent has changed a file here yet"
        detail="Lines are tracked from each agent turn that starts on this version."
        styles={styles}
      />
    );
  } else {
    body = (
      <FlatList
        data={tracked}
        keyExtractor={fileKey}
        renderItem={renderFile}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        testID="attribution-files"
      />
    );
  }
  return (
    <>
      <Bar
        title="Attribution"
        subtitle={tracked.length > 0 ? `${filesLabel(tracked.length)} changed by agents` : ""}
        styles={styles}
        onRefresh={reload}
      />
      {body}
    </>
  );
}

interface ChipProps {
  agent: LegendAgent;
  chosen: boolean;
  styles: AttributionStyles;
  onChoose(agentId: string): void;
}

function Chip({ agent, chosen, styles, onChoose }: ChipProps) {
  const { name } = useAgentName(agent);
  const choose = useCallback(() => onChoose(agent.id), [agent.id, onChoose]);
  return (
    <Pressable
      onPress={choose}
      accessibilityRole="button"
      accessibilityLabel={`Agent ${agent.number}, ${name}, ${linesLabel(agent.lines)}`}
      aria-pressed={chosen}
      style={chosen ? styles.chipChosen : styles.chip}
      testID="attribution-agent"
    >
      <View style={chosen ? styles.chipNumberChosen : styles.chipNumber}>
        <Text style={chosen ? styles.chipNumberTextChosen : styles.chipNumberText}>
          {agent.number}
        </Text>
      </View>
      <Text style={styles.chipName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.chipCount}>{linesLabel(agent.lines)}</Text>
    </Pressable>
  );
}

interface LineProps {
  row: LineRow;
  /** The line is in the run whose turn is shown under the lines. */
  shown: boolean;
  styles: AttributionStyles;
  /** `pageY` is where the line was pressed, when a pointer or a finger pressed it. */
  onChoose(line: number, pageY: number | undefined): void;
}

const Line = memo(function Line({ row, shown, styles, onChoose }: LineProps) {
  const choose = useCallback(
    (event: GestureResponderEvent) => onChoose(row.number, event.nativeEvent?.pageY),
    [row.number, onChoose],
  );
  const marked = row.chosen || shown;
  const style = useCallback(
    (state: PressState) => {
      if (marked) return styles.lineChosen;
      return lit(state) ? styles.linePressed : styles.line;
    },
    [marked, styles],
  );
  const cells = (
    <>
      <View style={stripeOf(row, marked, styles)} />
      <Text style={marked ? styles.gutterChosen : styles.gutter}>{row.label}</Text>
      <Text style={styles.lineNumber}>{row.number}</Text>
      <Text style={styles.code}>{row.text === "" ? " " : row.text}</Text>
    </>
  );
  // A line no agent wrote has nothing to choose: it is not a control.
  if (row.turn === -1) return <View style={styles.line}>{cells}</View>;
  return (
    <Pressable
      onPress={choose}
      accessibilityRole="button"
      accessibilityLabel={`Line ${row.number}, written by an agent. Show its turn`}
      // The keyboard stops once per run of lines, not once per line.
      focusable={row.label !== ""}
      style={style}
      testID="attribution-line"
    >
      {cells}
    </Pressable>
  );
});

function stripeOf(row: LineRow, marked: boolean, styles: AttributionStyles) {
  if (row.turn === -1) return styles.stripe;
  return marked ? styles.stripeChosen : styles.stripeAgent;
}

const lineKey = (row: LineRow) => String(row.number);
/** The height the turn's bar may take, with room to spare: a line pressed lower is scrolled up. */
const TURN_BAR_ROOM = 200;
const ignore = () => undefined;

interface TurnAgentProps {
  agent: Author;
  styles: AttributionStyles;
  openAgent?: OpenAgent;
}

function TurnAgent({ agent, styles, openAgent }: TurnAgentProps) {
  const { name, open } = useAgentName(agent);
  const show = useCallback(() => openAgent?.({ agentId: agent.id }), [agent.id, openAgent]);
  const button = useCallback(
    (state: PressState) => (lit(state) ? styles.buttonPressed : styles.button),
    [styles],
  );
  return (
    <View style={styles.detailAgent}>
      <Text style={styles.detailName} numberOfLines={1}>
        {name}
      </Text>
      {open && openAgent ? (
        <Pressable
          onPress={show}
          accessibilityRole="button"
          accessibilityLabel={`Open the agent ${name}`}
          style={button}
          testID="attribution-open-agent"
        >
          <Text style={styles.buttonText}>Open agent</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface TurnDetailProps {
  mark: Mark;
  turn: Turn;
  styles: AttributionStyles;
  openAgent?: OpenAgent;
  onClose(): void;
}

function TurnDetail({ mark, turn, styles, openAgent, onClose }: TurnDetailProps) {
  const shared = turn.agents.length > 1 ? " · written while these agents ran together" : "";
  return (
    <View style={styles.detail} accessibilityLiveRegion="polite" testID="attribution-turn">
      <View style={styles.detailText}>
        <Text
          style={styles.detailTitle}
        >{`${rangeLabel(mark)} · ${whenLabel(turn.at)}${shared}`}</Text>
        <View style={styles.detailAgents}>
          {turn.agents.map((agent) => (
            <TurnAgent key={agent.id} agent={agent} styles={styles} openAgent={openAgent} />
          ))}
        </View>
      </View>
      <IconButton icon="X" label="Hide the turn" styles={styles} onPress={onClose} />
    </View>
  );
}

interface FileBodyProps {
  file: ReadyFile;
  styles: AttributionStyles;
  openAgent?: OpenAgent;
}

function FileBody({ file, styles, openAgent }: FileBodyProps) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const legend = useMemo(() => legendOf(file), [file]);
  const rows = useMemo(() => rowsOf(file, legend, agentId), [file, legend, agentId]);
  const chooseAgent = useCallback(
    (id: string) => setAgentId((now) => (now === id ? null : id)),
    [],
  );
  const hide = useCallback(() => setLine(null), []);
  const list = useRef<NativeFlatList<LineRow>>(null);
  // The turn's bar takes its room from the bottom of the list. A line chosen down there, or
  // from the keyboard, is brought back into view.
  const bring = useRef(false);
  const chooseLine = useCallback((number: number, pageY: number | undefined) => {
    bring.current = !pageY || pageY > Dimensions.get("window").height - TURN_BAR_ROOM;
    setLine(number);
  }, []);
  useEffect(() => {
    if (!bring.current || line === null) return undefined;
    bring.current = false;
    const frame = requestAnimationFrame(() => {
      try {
        list.current?.scrollToIndex({ index: line - 1, viewPosition: 0.5 });
      } catch {
        // A list that cannot scroll there leaves the line where it is.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [line]);
  const mark = useMemo(() => (line === null ? null : markAt(file.marks, line)), [file, line]);
  const turn = mark ? file.turns[mark.turn] : undefined;
  const renderLine = useCallback(
    ({ item }: { item: LineRow }) => (
      <Line
        row={item}
        shown={mark !== null && item.number >= mark.start && item.number < mark.start + mark.count}
        styles={styles}
        onChoose={chooseLine}
      />
    ),
    [styles, mark, chooseLine],
  );
  return (
    <>
      <View style={styles.legend}>
        <Text style={styles.muted}>{summaryLabel(legend)}</Text>
        {legend.agents.map((agent) => (
          <Chip
            key={agent.id}
            agent={agent}
            chosen={agent.id === agentId}
            styles={styles}
            onChoose={chooseAgent}
          />
        ))}
      </View>
      <FlatList
        ref={list}
        data={rows}
        onScrollToIndexFailed={ignore}
        keyExtractor={lineKey}
        renderItem={renderLine}
        style={styles.lines}
        contentContainerStyle={styles.listContent}
        initialNumToRender={60}
        testID="attribution-lines"
      />
      {mark && turn ? (
        <TurnDetail mark={mark} turn={turn} styles={styles} openAgent={openAgent} onClose={hide} />
      ) : null}
    </>
  );
}

interface FileViewProps {
  workspaceId: string;
  path: string;
  styles: AttributionStyles;
  openAgent?: OpenAgent;
  onBack(): void;
}

function FileView({ workspaceId, path, styles, openAgent, onBack }: FileViewProps) {
  const [file, reload] = useFile(workspaceId, path);
  const { name, folder } = splitPath(path);
  const retry = useMemo(() => ({ label: "Try again", onPress: reload }), [reload]);
  let body;
  if (file.status === "loading") {
    body = <Loading />;
  } else if (file.status === "error") {
    body = (
      <Message
        title="The file could not be read"
        detail={file.message}
        failed
        styles={styles}
        action={retry}
      />
    );
  } else if (file.value.status === "ready") {
    body = <FileBody file={file.value} styles={styles} openAgent={openAgent} />;
  } else {
    body = <Message title={statusLabel(file.value.status)} styles={styles} />;
  }
  return (
    <>
      <Bar title={name} subtitle={folder} styles={styles} onBack={onBack} onRefresh={reload} />
      {body}
    </>
  );
}

/** Who wrote the lines of the workspace's files: the files agents changed, then one file. */
export function AttributionPanel({
  theme,
  layout,
  workspaceId,
  tab,
  navigation,
}: PluginWorkspacePanelProps) {
  // Asked once for the panel's life, like the app: a mouse plugged into a tablet does not shrink
  // its controls.
  const touch = useMemo(() => hasTouchScreen(layout.platform), [layout.platform]);
  const styles = useAttributionStyles(theme, layout.compact || touch, layout.compact);
  const [state, setState] = useTabState(tab, TabState, NO_FILE);
  const open = useCallback((path: string) => setState({ path }), [setState]);
  const back = useCallback(() => setState(NO_FILE), [setState]);
  return (
    <View style={styles.panel} testID="attribution-panel">
      <View style={styles.column}>
        {state.path === null ? (
          <FilesView workspaceId={workspaceId} styles={styles} onOpen={open} />
        ) : (
          <FileView
            // Another file starts with nothing chosen.
            key={state.path}
            workspaceId={workspaceId}
            path={state.path}
            styles={styles}
            openAgent={navigation?.openAgent}
            onBack={back}
          />
        )}
      </View>
    </View>
  );
}
