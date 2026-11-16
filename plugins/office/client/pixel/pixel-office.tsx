import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ScrollView as NativeScrollView,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { Machine } from "../../shared/contracts.js";
import type { FocusRequest } from "../focus-request.js";
import { hostNote, type HostNote } from "../machine-text.js";
import type { OfficeModel, OfficeRoom } from "../model.js";
import {
  boardRoom,
  boardText,
  floorNote,
  fullness,
  isDarkTheme,
  worldChanges,
  worldPeople,
  type WorldMemory,
  type WorldPeople,
} from "../world/adapter.js";
import {
  NO_BREAKS,
  NO_RESTS,
  NO_VISITS,
  TURN_MS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  restsAfter,
  trayOf,
  visitsAfter,
  visitsSwept,
  type Breaks,
  type CastMember,
  type Leisure,
  type Rests,
  type Visits,
} from "./actors.js";
import {
  SHIRTS,
  artFor,
  lookOf,
  type Art,
  type IconKind,
  type Pose,
  type ScreenKind,
} from "./art.js";
import {
  FLOOR_DESKS,
  SIZE,
  SLOT,
  planFloor,
  routeBetween,
  spotAt,
  type FloorPlan,
  type PlaceKind,
  type PlanDesk,
  type PlanTeam,
  type PlanTeamPlate,
  type Point,
} from "./floor-plan.js";
import { roomFurniture, roomRects } from "./room.js";
import { SpriteView } from "./sprite-view.js";
import { createTicker } from "./ticker.js";

export interface PixelOfficeProps {
  model: OfficeModel;
  /** The rooms in the surface's order: a workspace tab's own room first. */
  rooms: readonly OfficeRoom[];
  theme: PluginTheme;
  /** The workspace tab's room; the whiteboard opens its board. */
  focusRoomId: string | null;
  /** A tap in the attention strip: the floor scrolls to that agent's desk. */
  focusRequest: FocusRequest | null;
  onSelectAgent(agentId: string): void;
  onSelectBoard(roomId: string): void;
  /** The host's readings; null when the host has none, and then the racks are furniture. */
  machine: Machine | null;
  onOpenMachine(): void;
  /** How full the contexts are, in a few words; null in an office without agents. */
  janitor: HostNote | null;
  onOpenJanitor(): void;
  /** The stand-up is open: whoever rests gathers at the whiteboard. */
  meeting: boolean;
}

const NATIVE = Platform.OS !== "web";
/**
 * Art pixels a person walks in a second: four desks. From the far end of a phone's floor to the
 * wall is then about seven seconds, near the five between two reads of what an agent is at.
 */
const WALK_SPEED = 64;
const FLIGHT_MS = 2600;
/** How long the janitor sweeps at a desk before its tray is empty. */
const SWEEP_MS = 2400;
/** Legs step at every frame; a screen scrolls at every second one, the racks at every fourth. */
const FRAME_MS = 200;
const FRAMES = createTicker(FRAME_MS);
const noFrames = () => () => undefined;
const frameZero = () => 0;

/** The shared frame count while `active`; 0, and no timer, while not. */
function useFrame(active: boolean): number {
  return useSyncExternalStore(
    active ? FRAMES.subscribe : noFrames,
    active ? FRAMES.frame : frameZero,
    frameZero,
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    async function ask(): Promise<void> {
      const on = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      if (live) setReduce(on);
    }
    void ask();
    const listening = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      live = false;
      listening.remove();
    };
  }, []);
  return reduce;
}

interface FloorLife {
  breaks: Breaks;
  /** Since when each person rests. */
  rests: Rests;
  /** The time the lively floor goes by: it moves on when a turn ends. */
  now: number;
  /** The desks the janitor is due at. */
  visits: Visits;
  /** The janitor swept at this agent's desk. */
  swept(agentId: string): void;
}

/**
 * What the floor remembers. Who is on a coffee break: a turn that ended starts one, and its time
 * or new work ends it. Since when each person rests, for the lively floor, and the time its
 * turns go by. And the janitor's round: a context that emptied calls the janitor to that desk.
 */
function useFloorLife(people: WorldPeople, still: boolean): FloorLife {
  const [breaks, setBreaks] = useState<Breaks>(NO_BREAKS);
  const [rests, setRests] = useState<Rests>(NO_RESTS);
  const [now, setNow] = useState(() => Date.now());
  const [visits, setVisits] = useState<Visits>(NO_VISITS);
  const memory = useRef<WorldMemory | null>(null);
  const sessions = useRef(people.sessions);
  useEffect(() => {
    sessions.current = people.sessions;
    const known = memory.current;
    const changes = worldChanges(known, people);
    memory.current = changes.memory;
    const seated = new Set(people.sessions.map((session) => session.id));
    setBreaks((before) => breaksAfter(before, changes.events, people.sessions, Date.now()));
    setRests((before) => restsAfter(before, people.sessions, Date.now()));
    setVisits((before) => visitsAfter(before, changes.events, known, seated));
  }, [people]);
  // The lounge is looked at again when a turn of the lively floor ends.
  useEffect(() => {
    if (still) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), TURN_MS - (now % TURN_MS) + 20);
    return () => clearTimeout(timer);
  }, [now, still]);
  const swept = useCallback(
    (agentId: string) => setVisits((before) => visitsSwept(before, agentId)),
    [],
  );
  useEffect(() => {
    const end = nextBreakEnd(breaks);
    if (end === null) return undefined;
    const timer = setTimeout(
      () => setBreaks((before) => breaksAfter(before, [], sessions.current, Date.now())),
      Math.max(0, end - Date.now()) + 20,
    );
    return () => clearTimeout(timer);
  }, [breaks]);
  // With motion reduced nobody walks: nobody is shown away for a break, and a tray is empty
  // without a visit.
  return still
    ? { breaks: NO_BREAKS, rests, now, visits: NO_VISITS, swept }
    : { breaks, rests, now, visits, swept };
}

interface PixelStyles {
  floor: ViewStyle;
  scroll: ViewStyle;
  content: ViewStyle;
  map: ViewStyle;
  note: TextStyle;
  plateHit: ViewStyle;
  plate: ViewStyle;
  plateLit: ViewStyle;
  /** The veil over a desk, the whiteboard, the racks or a person under a pointer or a finger. */
  lit: ViewStyle;
  plateIcon: ViewStyle;
  plateName: TextStyle;
  plateCount: TextStyle;
  slotHit: ViewStyle;
  tag: ViewStyle;
  tagMark: ViewStyle;
  tagText: TextStyle;
  /** A person at the desk takes no taps, the desk under them does; one away from it takes their own. */
  personSeated: ViewStyle;
  personAway: ViewStyle;
  personHit: ViewStyle;
  bubbleAtDesk: ViewStyle;
  bubbleOverHead: ViewStyle;
  /** The janitor and the broom beside them; taps go to the button at the cart. */
  janitor: ViewStyle;
}

const TOUCH_TARGET = 44;

/** A plate is 24 px tall whatever the room's scale, so its icon stops growing at 16 px. */
function plateIconScale(scale: number): number {
  return Math.min(scale, 2);
}

/** Room above a plate that takes its taps too: the plate is 24 px tall, a touch target 44. */
const PLATE_REACH = 20;
const PLATE_HEIGHT = 24;

function pixelStyles(art: Art, plan: FloorPlan | null): PixelStyles {
  const { tones } = art;
  const scale = plan?.scale ?? 2;
  // Two lines of a name fit a tag, which is as wide as its slot: 80 px on a phone.
  const small: TextStyle =
    scale >= 3 ? { fontSize: 12, lineHeight: 14 } : { fontSize: 11, lineHeight: 13 };
  const person: ViewStyle = {
    position: "absolute",
    left: 0,
    top: 0,
    width: SIZE.person.w * scale,
    height: SIZE.person.h * scale,
  };
  const plate: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    height: PLATE_HEIGHT,
    gap: 6,
    paddingHorizontal: 6,
  };
  const bubble: ViewStyle = {
    position: "absolute",
    width: SIZE.bubble.w * scale,
    height: SIZE.bubble.h * scale,
    pointerEvents: "none",
  };
  return {
    floor: { flex: 1, backgroundColor: tones.floor },
    scroll: { flex: 1 },
    content: { alignItems: "center" },
    map: {
      width: (plan?.width ?? 0) * scale,
      height: (plan?.height ?? 0) * scale,
      overflow: "hidden",
    },
    note: {
      fontSize: 12,
      lineHeight: 16,
      color: tones.textMuted,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: 480,
    },
    plateHit: { position: "absolute", paddingTop: PLATE_REACH, minWidth: TOUCH_TARGET },
    plate: { ...plate, backgroundColor: tones.shadow },
    plateLit: { ...plate, backgroundColor: tones.plateLit },
    lit: { backgroundColor: tones.veil },
    plateIcon: { width: 8 * plateIconScale(scale), height: 8 * plateIconScale(scale) },
    plateName: { fontSize: 12, lineHeight: 16, fontWeight: "500", color: tones.text },
    plateCount: { fontSize: 12, lineHeight: 16, color: tones.textMuted },
    slotHit: { position: "absolute" },
    tag: {
      position: "absolute",
      left: 0,
      top: (SIZE.seated.h + 12 + 1) * scale,
      width: SLOT * scale,
      height: (plan?.tagHeight ?? 8) * scale,
      alignItems: "center",
      gap: 2,
      paddingHorizontal: 1,
      pointerEvents: "none",
    },
    // The person's shirt colour under the chair: who the desk belongs to when nobody sits there.
    tagMark: { width: SIZE.seated.w * scale, height: 3 },
    tagText: { ...small, alignSelf: "stretch", textAlign: "center", color: tones.text },
    personSeated: { ...person, pointerEvents: "none" },
    personAway: person,
    // Wider than the person: 12 by 16 art pixels are 24 by 32 on a phone, a touch target is 44.
    personHit: { position: "absolute", left: -10, right: -10, top: -8, bottom: -4 },
    // Beside the screen, over the desk's right half: the screen stays readable, and so does
    // the tray under it.
    bubbleAtDesk: { ...bubble, left: 13 * scale, top: -17 * scale },
    bubbleOverHead: { ...bubble, left: 0, top: -SIZE.bubble.h * scale },
    janitor: { ...person, width: (SIZE.person.w + 4) * scale, pointerEvents: "none" },
  };
}

interface Lit {
  /** A pointer is over it or a finger is on it. */
  lit: boolean;
  handlers: {
    onHoverIn(): void;
    onHoverOut(): void;
    onPressIn(): void;
    onPressOut(): void;
  };
}

/** Whether a control is under a pointer or a finger, and the handlers that tell. */
function useLit(): Lit {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handlers = useMemo(
    () => ({
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
      onPressIn: () => setPressed(true),
      onPressOut: () => setPressed(false),
    }),
    [],
  );
  return { lit: hovered || pressed, handlers };
}

interface HitProps {
  /** The button's name. Without one it is for a pointer only: no tab stop, hidden from a reader. */
  label?: string;
  /** Where it is and how large. */
  box: ViewStyle;
  /** What it puts on under a pointer or a finger. */
  veil: ViewStyle;
  onPress(): void;
  children?: ReactNode;
}

/** What takes a tap on the floor: a button over a picture, veiled while it is pointed at. */
function Hit({ label, box, veil, onPress, children }: HitProps) {
  const { lit, handlers } = useLit();
  const style = useMemo(() => (lit ? [box, veil] : box), [box, veil, lit]);
  return (
    <Pressable
      accessibilityRole={label === undefined ? undefined : "button"}
      accessibilityLabel={label}
      aria-hidden={label === undefined}
      tabIndex={label === undefined ? -1 : 0}
      onPress={onPress}
      onHoverIn={handlers.onHoverIn}
      onHoverOut={handlers.onHoverOut}
      onPressIn={handlers.onPressIn}
      onPressOut={handlers.onPressOut}
      style={style}
    >
      {children}
    </Pressable>
  );
}

interface RoomProps {
  plan: FloorPlan;
  art: Art;
}

/** What never moves: the wall, the floor's seams, the rug and the furniture. */
const Room = memo(function Room({ plan, art }: RoomProps) {
  const { scale } = plan;
  const rects = useMemo(
    () =>
      roomRects(plan, art.tones).map((rect, index) => ({
        key: `${index}`,
        style: {
          position: "absolute",
          left: rect.x * scale,
          top: rect.y * scale,
          width: rect.w * scale,
          height: rect.h * scale,
          backgroundColor: rect.color,
          pointerEvents: "none",
        } satisfies ViewStyle,
      })),
    [plan, art, scale],
  );
  const furniture = useMemo(() => roomFurniture(plan, art), [plan, art]);
  return (
    <>
      {rects.map((rect) => (
        <View key={rect.key} style={rect.style} />
      ))}
      {furniture.map((item) => (
        <SpriteView key={item.key} sprite={item.sprite} scale={scale} x={item.x} y={item.y} />
      ))}
    </>
  );
});

interface BubbleProps {
  icon: IconKind;
  art: Art;
  scale: number;
  style: ViewStyle;
}

function Bubble({ icon, art, scale, style }: BubbleProps) {
  return (
    <View style={style}>
      <SpriteView sprite={art.bubble} scale={scale} x={0} y={0} />
      <SpriteView sprite={art.icon(icon)} scale={scale} x={2} y={2} />
    </View>
  );
}

interface BoardButtonProps {
  at: Point;
  scale: number;
  styles: PixelStyles;
  onOpen(): void;
}

/** The whiteboard: a tap opens a board. The picture is the room's; this is what takes the tap. */
function BoardButton({ at, scale, styles, onOpen }: BoardButtonProps) {
  const box = useMemo(
    (): ViewStyle => ({
      position: "absolute",
      left: at.x * scale,
      top: (at.y - 2) * scale,
      width: SIZE.board.w * scale,
      height: (SIZE.board.h + 4) * scale,
    }),
    [at, scale],
  );
  return <Hit label="Board" box={box} veil={styles.lit} onPress={onOpen} />;
}

interface RacksProps {
  racks: readonly Point[];
  /** The host in a few words; null when the host has no readings. */
  note: HostNote | null;
  /** Somebody works: the lamps blink. */
  busy: boolean;
  art: Art;
  scale: number;
  veil: ViewStyle;
  onOpen(): void;
}

const ALERT: Readonly<Record<HostNote["tone"], IconKind | null>> = {
  muted: null,
  warning: "alert",
  danger: "fail",
};

/** The server racks stand for the host: a tap opens its card, and a bubble says it needs a look. */
const Racks = memo(function Racks({ racks, note, busy, art, scale, veil, onOpen }: RacksProps) {
  const frame = useFrame(busy);
  const lit = (frame >> 2) % 2;
  const first = racks[0];
  const styles = useMemo(() => {
    const left = (first?.x ?? 0) * scale;
    const width = (racks.length * (SIZE.rack.w + 2) - 2) * scale;
    // One rack on a narrow phone is 28 px wide: the target reaches left to a touch target's 44.
    const reach = Math.max(width, TOUCH_TARGET);
    const hit: ViewStyle = {
      position: "absolute",
      left: left + width - reach,
      top: (first?.y ?? 0) * scale,
      width: reach,
      height: SIZE.rack.h * scale,
    };
    const bubble: ViewStyle = {
      position: "absolute",
      left: left - (SIZE.bubble.w + 1) * scale,
      top: ((first?.y ?? 0) + 4) * scale,
      width: SIZE.bubble.w * scale,
      height: SIZE.bubble.h * scale,
      pointerEvents: "none",
    };
    return { hit, bubble };
  }, [first, racks.length, scale]);
  const alert = note === null ? null : ALERT[note.tone];
  return (
    <>
      {racks.map((rack, index) => (
        <SpriteView
          key={rack.x}
          sprite={art.rack[(index + lit) % 2 === 0 ? 0 : 1]}
          scale={scale}
          x={rack.x}
          y={rack.y}
        />
      ))}
      {alert === null ? null : (
        <Bubble icon={alert} art={art} scale={scale} style={styles.bubble} />
      )}
      {note === null ? null : (
        <Hit label={`Host: ${note.text}`} box={styles.hit} veil={veil} onPress={onOpen} />
      )}
    </>
  );
});

interface PlateProps {
  plate: PlanTeamPlate;
  art: Art;
  scale: number;
  styles: PixelStyles;
  onOpen(roomId: string): void;
}

/** A team's plate over its desks: its name, how many sit there, and a tap for its board. */
const Plate = memo(function Plate({ plate, art, scale, styles, onOpen }: PlateProps) {
  const press = useCallback(() => onOpen(plate.id), [onOpen, plate.id]);
  const { lit, handlers } = useLit();
  const at = useMemo(
    (): ViewStyle => ({
      ...styles.plateHit,
      left: plate.x * scale,
      top: plate.y * scale - PLATE_REACH,
      maxWidth: Math.max(plate.width, SLOT * 2) * scale,
    }),
    [styles, plate, scale],
  );
  const agents = plate.count === 1 ? "1 agent" : `${plate.count} agents`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${plate.name} board, ${agents}`}
      onPress={press}
      onHoverIn={handlers.onHoverIn}
      onHoverOut={handlers.onHoverOut}
      onPressIn={handlers.onPressIn}
      onPressOut={handlers.onPressOut}
      style={at}
    >
      <View style={lit ? styles.plateLit : styles.plate}>
        <View style={styles.plateIcon}>
          <SpriteView sprite={art.plateMark} scale={plateIconScale(scale)} x={0} y={0} />
        </View>
        <Text style={styles.plateName} numberOfLines={1}>
          {plate.name}
        </Text>
        <Text style={styles.plateCount}>{plate.count}</Text>
      </View>
    </Pressable>
  );
});

interface DeskViewProps {
  desk: PlanDesk;
  member: CastMember;
  /** The desk's name for a screen reader: who sits there and what they are at. */
  label: string;
  /** The agent has a port open: a server box stands on the desk. */
  serving: boolean;
  /** The paper in the desk's tray, 0 to 3 levels, and the flag of a context that is nearly full. */
  sheets: number;
  flag: boolean;
  art: Art;
  scale: number;
  tagHeight: number;
  still: boolean;
  styles: PixelStyles;
  onSelect(agentId: string): void;
}

/** A desk with its screen, its chair and its name tag. The whole of it opens the agent's card. */
const DeskView = memo(function DeskView({
  desk,
  member,
  label,
  serving,
  sheets,
  flag,
  art,
  scale,
  tagHeight,
  still,
  styles,
  onSelect,
}: DeskViewProps) {
  const { screen } = member.standing;
  const frame = useFrame(screen === "code" && !still);
  const press = useCallback(() => onSelect(member.id), [onSelect, member.id]);
  const look = useMemo(() => lookOf(member.id), [member.id]);
  const slot = useMemo(
    (): ViewStyle => ({
      ...styles.slotHit,
      left: (desk.x - (SLOT - SIZE.desk.w) / 2) * scale,
      top: desk.y * scale,
      width: SLOT * scale,
      height: (12 + SIZE.seated.h + 1 + tagHeight) * scale,
    }),
    [styles, desk.x, desk.y, scale, tagHeight],
  );
  const mark = useMemo(
    (): ViewStyle => ({
      ...styles.tagMark,
      backgroundColor: (SHIRTS[look.shirt] ?? SHIRTS[0]).shirt,
    }),
    [styles, look],
  );
  let picture: ScreenKind = screen === "code" ? "codeA" : screen;
  if (screen === "code" && (frame >> 1) % 2 === 1) picture = "codeB";
  const inset = (SLOT - SIZE.desk.w) / 2;
  return (
    <Hit label={label} box={slot} veil={styles.lit} onPress={press}>
      <SpriteView sprite={art.desk} scale={scale} x={inset} y={0} />
      <SpriteView sprite={art.screen(picture)} scale={scale} x={inset + 9} y={1} />
      {serving ? <SpriteView sprite={art.server} scale={scale} x={inset + 1} y={3} /> : null}
      <SpriteView sprite={art.tray(sheets, flag)} scale={scale} x={inset + 23} y={4} />
      <SpriteView sprite={art.chair} scale={scale} x={inset + 9} y={12} />
      <View style={styles.tag}>
        <View style={mark} />
        <Text style={styles.tagText} numberOfLines={2}>
          {member.name}
        </Text>
      </View>
    </Hit>
  );
});

interface Walk {
  position: Animated.ValueXY;
  corners: readonly Point[];
  scale: number;
  /** False once another walk has started or the person has left. */
  current(): boolean;
  /** A leg starts: up the room, or down or across it. */
  onLeg(up: boolean): void;
  onCorner(corner: Point): void;
  onArrive(): void;
}

/** Walks the corners one leg after another, at one speed. */
function walkAlong(walk: Walk, here: Point, index: number): void {
  if (!walk.current()) return;
  const corner = walk.corners[index];
  if (corner === undefined) {
    walk.onArrive();
    return;
  }
  walk.onLeg(corner.y < here.y);
  const distance = Math.abs(corner.x - here.x) + Math.abs(corner.y - here.y);
  Animated.timing(walk.position, {
    toValue: { x: corner.x * walk.scale, y: corner.y * walk.scale },
    duration: (distance / WALK_SPEED) * 1000,
    easing: Easing.linear,
    useNativeDriver: NATIVE,
  }).start(({ finished }) => {
    if (!finished || !walk.current()) return;
    walk.onCorner(corner);
    walkAlong(walk, corner, index + 1);
  });
}

type Motion = { kind: "seated" } | { kind: "standing" } | { kind: "walking"; up: boolean };

const SEATED: Motion = { kind: "seated" };
const STANDING: Motion = { kind: "standing" };
/** At these a person looks at the wall, or at the plant; elsewhere in the lounge, at the room. */
const AT_THE_WALL: ReadonlySet<PlaceKind> = new Set(["library", "board", "racks", "plant"]);

function poseOf(motion: Motion, place: PlaceKind | null, frame: number): Pose {
  if (motion.kind === "seated") return "seated";
  if (motion.kind === "standing")
    return place !== null && AT_THE_WALL.has(place) ? "back" : "front";
  const step = frame % 2 === 0;
  if (motion.up) return step ? "backA" : "backB";
  return step ? "frontA" : "frontB";
}

interface PersonViewProps {
  member: CastMember;
  desk: PlanDesk;
  /** Where the person stands away from the desk, in art pixels; null at the desk. */
  awayX: number | null;
  awayY: number | null;
  laneX: number;
  art: Art;
  scale: number;
  still: boolean;
  styles: PixelStyles;
  onSelect(agentId: string): void;
}

/**
 * A person: seated at the desk, standing at a place, or on the way between them. A new place is
 * walked to; a room that changed shape under a person who stays where they were puts them there
 * at once.
 */
const PersonView = memo(function PersonView({
  member,
  desk,
  awayX,
  awayY,
  laneX,
  art,
  scale,
  still,
  styles,
  onSelect,
}: PersonViewProps) {
  const away = awayX !== null && awayY !== null;
  const restX = away ? awayX : desk.seat.x;
  const restY = away ? awayY : desk.seat.y;
  const position = useRef(new Animated.ValueXY({ x: restX * scale, y: restY * scale })).current;
  // Where the person is on the floor's lines: behind the chair when seated.
  const at = useRef<Point>({ x: restX, y: away ? restY : desk.aisleY });
  const [motion, setMotionState] = useState<Motion>(away ? STANDING : SEATED);
  const motionNow = useRef(motion);
  const setMotion = useCallback((next: Motion) => {
    motionNow.current = next;
    setMotionState(next);
  }, []);
  const walk = useRef(0);
  const place = away ? `${member.standing.place}:${member.spot}` : "desk";
  const lastPlace = useRef(place);

  useEffect(() => {
    const moved = lastPlace.current !== place;
    lastPlace.current = place;
    walk.current += 1;
    const id = walk.current;
    const end = { x: restX, y: away ? restY : desk.aisleY };
    const arrive = () => {
      at.current = end;
      position.setValue({ x: restX * scale, y: restY * scale });
      setMotion(away ? STANDING : SEATED);
    };
    if (!moved || still) {
      position.stopAnimation();
      arrive();
      return;
    }
    position.stopAnimation((value) => {
      if (id !== walk.current) return;
      // Someone on the way turns round where they are; anyone else starts from their line.
      const here =
        motionNow.current.kind === "walking"
          ? { x: Math.round(value.x / scale), y: Math.round(value.y / scale) }
          : at.current;
      position.setValue({ x: here.x * scale, y: here.y * scale });
      walkAlong(
        {
          position,
          corners: routeBetween(here, end, laneX),
          scale,
          current: () => id === walk.current,
          onLeg: (up) => setMotion({ kind: "walking", up }),
          onCorner: (corner) => {
            at.current = corner;
          },
          onArrive: arrive,
        },
        here,
        0,
      );
    });
  }, [place, restX, restY, away, desk.aisleY, laneX, scale, still, position, setMotion]);

  useEffect(
    () => () => {
      walk.current += 1;
      position.stopAnimation();
    },
    [position],
  );

  const frame = useFrame(motion.kind === "walking");
  const pose = poseOf(motion, member.standing.place, frame);
  const look = useMemo(() => lookOf(member.id), [member.id]);
  const press = useCallback(() => onSelect(member.id), [onSelect, member.id]);
  const { icon } = member.standing;
  const seated = motion.kind === "seated";
  const box = useMemo(
    () => [
      seated ? styles.personSeated : styles.personAway,
      { transform: position.getTranslateTransform() },
    ],
    [styles, position, seated],
  );
  return (
    <Animated.View style={box}>
      <SpriteView sprite={art.person(look, pose)} scale={scale} x={0} y={0} />
      {icon === null ? null : (
        <Bubble
          icon={icon}
          art={art}
          scale={scale}
          style={seated ? styles.bubbleAtDesk : styles.bubbleOverHead}
        />
      )}
      {seated ? null : (
        // The desk already names this person for a keyboard and a screen reader.
        <Hit box={styles.personHit} veil={styles.lit} onPress={press} />
      )}
    </Animated.View>
  );
});

type JanitorMotion = { kind: "home" } | { kind: "sweeping" } | { kind: "walking"; up: boolean };

const AT_HOME: JanitorMotion = { kind: "home" };
const SWEEPING: JanitorMotion = { kind: "sweeping" };

function janitorPose(motion: JanitorMotion, frame: number): Pose {
  if (motion.kind === "home") return "front";
  const step = frame % 2 === 0;
  // The desk is up the room from its aisle: the janitor sweeps with the back to the viewer.
  if (motion.kind === "sweeping" || motion.up) return step ? "backA" : "backB";
  return step ? "frontA" : "frontB";
}

interface JanitorViewProps {
  /** The desk the janitor is due at: whose it is and where to stand; null when no desk is. */
  dueId: string | null;
  dueX: number;
  dueY: number;
  homeX: number;
  homeY: number;
  laneX: number;
  art: Art;
  scale: number;
  styles: PixelStyles;
  onSwept(agentId: string): void;
}

/**
 * The janitor: beside the cart until a desk is due, then on the way there, sweeping, and on to
 * the next desk or back. A room that changed shape under a janitor who stays puts them there at
 * once.
 */
const JanitorView = memo(function JanitorView({
  dueId,
  dueX,
  dueY,
  homeX,
  homeY,
  laneX,
  art,
  scale,
  styles,
  onSwept,
}: JanitorViewProps) {
  const goalX = dueId === null ? homeX : dueX;
  const goalY = dueId === null ? homeY : dueY;
  const position = useRef(new Animated.ValueXY({ x: goalX * scale, y: goalY * scale })).current;
  const at = useRef<Point>({ x: goalX, y: goalY });
  const [motion, setMotionState] = useState<JanitorMotion>(AT_HOME);
  const motionNow = useRef(motion);
  const setMotion = useCallback((next: JanitorMotion) => {
    motionNow.current = next;
    setMotionState(next);
  }, []);
  const walk = useRef(0);
  const goal = dueId ?? "home";
  const lastGoal = useRef(goal);

  useEffect(() => {
    const moved = lastGoal.current !== goal;
    lastGoal.current = goal;
    walk.current += 1;
    const id = walk.current;
    const end = { x: goalX, y: goalY };
    let sweeping: ReturnType<typeof setTimeout> | null = null;
    const arrive = () => {
      at.current = end;
      position.setValue({ x: goalX * scale, y: goalY * scale });
      if (dueId === null) {
        setMotion(AT_HOME);
        return;
      }
      setMotion(SWEEPING);
      sweeping = setTimeout(() => onSwept(dueId), SWEEP_MS);
    };
    if (moved) {
      position.stopAnimation((value) => {
        if (id !== walk.current) return;
        const here =
          motionNow.current.kind === "walking"
            ? { x: Math.round(value.x / scale), y: Math.round(value.y / scale) }
            : at.current;
        position.setValue({ x: here.x * scale, y: here.y * scale });
        walkAlong(
          {
            position,
            corners: routeBetween(here, end, laneX),
            scale,
            current: () => id === walk.current,
            onLeg: (up) => setMotion({ kind: "walking", up }),
            onCorner: (corner) => {
              at.current = corner;
            },
            onArrive: arrive,
          },
          here,
          0,
        );
      });
    } else {
      position.stopAnimation();
      arrive();
    }
    return () => {
      if (sweeping !== null) clearTimeout(sweeping);
    };
  }, [goal, dueId, goalX, goalY, laneX, scale, position, setMotion, onSwept]);

  useEffect(
    () => () => {
      walk.current += 1;
      position.stopAnimation();
    },
    [position],
  );

  const frame = useFrame(motion.kind !== "home");
  const box = useMemo(
    () => [styles.janitor, { transform: position.getTranslateTransform() }],
    [styles, position],
  );
  // At the cart the mop stands in the bucket; away from it the janitor has the broom in hand,
  // and a sweep moves it a pixel to and fro.
  const reach = motion.kind === "sweeping" && frame % 2 === 1 ? 1 : 0;
  return (
    <Animated.View style={box}>
      <SpriteView sprite={art.janitor(janitorPose(motion, frame))} scale={scale} x={0} y={0} />
      {motion.kind === "home" ? null : (
        <SpriteView sprite={art.broom} scale={scale} x={SIZE.person.w - 1 + reach} y={2} />
      )}
    </Animated.View>
  );
});

interface JanitorButtonProps {
  cart: Point;
  /** How full the contexts are, in a few words. */
  note: HostNote;
  art: Art;
  scale: number;
  veil: ViewStyle;
  onOpen(): void;
}

/** The cart and the janitor's place beside it: a tap opens the janitor's card. */
const JanitorButton = memo(function JanitorButton({
  cart,
  note,
  art,
  scale,
  veil,
  onOpen,
}: JanitorButtonProps) {
  const styles = useMemo(() => {
    // The cart and the janitor are 23 art pixels wide and 16 tall: on a phone 46 px by 32, so
    // the target reaches up to a touch target's 44.
    const width = (SIZE.cart.w - 1 + SIZE.person.w) * scale;
    const height = Math.max(SIZE.cart.h * scale, TOUCH_TARGET);
    const hit: ViewStyle = {
      position: "absolute",
      left: cart.x * scale,
      top: (cart.y + SIZE.cart.h) * scale - height,
      width,
      height,
    };
    const bubble: ViewStyle = {
      position: "absolute",
      left: cart.x * scale,
      top: (cart.y - SIZE.bubble.h - 1) * scale,
      width: SIZE.bubble.w * scale,
      height: SIZE.bubble.h * scale,
      pointerEvents: "none",
    };
    return { hit, bubble };
  }, [cart, scale]);
  const alert = ALERT[note.tone];
  return (
    <>
      {alert === null ? null : (
        <Bubble icon={alert} art={art} scale={scale} style={styles.bubble} />
      )}
      <Hit label={`Janitor: ${note.text}`} box={styles.hit} veil={veil} onPress={onOpen} />
    </>
  );
});

interface RocketProps {
  at: Point;
  /** What is being shipped, or null: a new one launches the rocket. */
  launch: string | null;
  art: Art;
  scale: number;
  still: boolean;
}

/** The rocket on its pad. It flies when somebody pushes or deploys, and is back for the next. */
const Rocket = memo(function Rocket({ at, launch, art, scale, still }: RocketProps) {
  const lift = useRef(new Animated.Value(0)).current;
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    if (launch === null || still) {
      lift.stopAnimation();
      lift.setValue(0);
      setFlying(false);
      return undefined;
    }
    lift.setValue(0);
    setFlying(true);
    const flight = Animated.timing(lift, {
      toValue: 1,
      duration: FLIGHT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: NATIVE,
    });
    flight.start();
    return () => flight.stop();
  }, [launch, still, lift]);
  const box = useMemo(
    () => ({
      position: "absolute" as const,
      left: at.x * scale,
      top: at.y * scale,
      width: SIZE.rocket.w * scale,
      height: SIZE.rocket.h * scale,
      pointerEvents: "none" as const,
      transform: [
        {
          translateY: lift.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -(at.y + SIZE.rocket.h + 8) * scale],
          }),
        },
      ],
    }),
    [at, scale, lift],
  );
  return (
    <>
      <SpriteView sprite={art.pad} scale={scale} x={at.x} y={at.y + 22} />
      <Animated.View style={box}>
        <SpriteView sprite={art.rocket} scale={scale} x={0} y={0} />
        {flying ? <SpriteView sprite={art.flame} scale={scale} x={4} y={20} /> : null}
      </Animated.View>
    </>
  );
});

/** The teams with a desk, in the rooms' order, each with the agents that sit there. */
function teamsOf(rooms: readonly OfficeRoom[], people: WorldPeople): PlanTeam[] {
  const seated = new Set(people.sessions.map((session) => session.id));
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    members: room.rows.map((row) => row.agent.id).filter((id) => seated.has(id)),
  }));
}

/**
 * The office as a pixel-art floor, drawn with plain views: it runs on a phone, in a browser
 * without WebGL and on a slow machine. The same agents as the 3D office, and the same places:
 * the library for reading, the racks for commands and tests, the whiteboard for plans, the desk
 * for edits, the pad for a push or a deploy, the coffee machine after a turn. By day whoever
 * rests takes turns in the lounge: on the sofa, at the coffee machine, at the plant. The paper on
 * a desk is its agent's context, and the janitor sweeps it away when the context empties.
 */
export function PixelOffice({
  model,
  rooms,
  theme,
  focusRoomId,
  focusRequest,
  onSelectAgent,
  onSelectBoard,
  machine,
  onOpenMachine,
  janitor,
  onOpenJanitor,
  meeting,
}: PixelOfficeProps) {
  const [widthPx, setWidthPx] = useState(0);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setWidthPx(Math.floor(event.nativeEvent.layout.width)),
    [],
  );
  const art = artFor(isDarkTheme(theme.colors));
  const still = useReduceMotion();
  // The floor seats the surface's order, so a workspace tab has its own team at the top.
  const ordered = useMemo((): OfficeModel => ({ ...model, rooms: [...rooms] }), [model, rooms]);
  const people = useMemo(() => worldPeople(ordered, FLOOR_DESKS), [ordered]);
  const { breaks, rests, now, visits, swept } = useFloorLife(people, still);
  // With motion reduced nobody walks to a stand-up either.
  const gathered = meeting && !still;
  // A desk the janitor is due at keeps its paper until the janitor has swept.
  const trays = useMemo(() => {
    const due = new Map(visits.map((visit) => [visit.agentId, visit.from]));
    return new Map(
      people.sessions.map((session) => [
        session.id,
        trayOf(due.get(session.id) ?? fullness(session)),
      ]),
    );
  }, [people, visits]);
  const teams = useMemo(() => teamsOf(rooms, people), [rooms, people]);
  const plan = useMemo(() => (widthPx > 0 ? planFloor(teams, widthPx) : null), [teams, widthPx]);
  // Nor to the lounge: the lively floor is for who may see people walk.
  const hasSofa = plan !== null && plan.sofa !== null;
  const leisure = useMemo(
    (): Leisure | null => (still ? null : { now, rests, sofa: hasSofa }),
    [still, now, rests, hasSofa],
  );
  const cast = useMemo(
    () => castOf(people, breaks, gathered, leisure),
    [people, breaks, gathered, leisure],
  );
  const styles = useMemo(() => pixelStyles(art, plan), [art, plan]);

  const labels = useMemo(() => {
    const activity = new Map(
      model.rooms.flatMap((room) => room.rows.map((row) => [row.agent.id, row.activity] as const)),
    );
    return new Map(
      people.sessions.map((session) => [
        session.id,
        `${session.name}: ${boardText(session, activity.get(session.id) ?? null)}`,
      ]),
    );
  }, [model, people]);
  const serving = useMemo(
    () =>
      new Set(
        (machine?.agents ?? [])
          .filter((agent) => agent.ports.length > 0)
          .map((agent) => agent.agentId),
      ),
    [machine],
  );
  const note = useMemo(() => (machine === null ? null : hostNote(machine)), [machine]);
  const busy = !still && people.sessions.some((session) => session.status === "work");
  const shipping = cast.find((member) => member.standing.place === "pad");
  const launch =
    shipping === undefined ? null : `${shipping.id}:${people.steps.get(shipping.id)?.key ?? ""}`;
  const openBoard = useCallback(() => {
    const roomId = boardRoom(model, { project: null, focusRoomId, selectedAgentId: null });
    if (roomId !== null) onSelectBoard(roomId);
  }, [model, focusRoomId, onSelectBoard]);

  // A request that was already there when the floor appeared was made for another view.
  const scroller = useRef<NativeScrollView>(null);
  const handled = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || plan === null || focusRequest.nonce === handled.current) return;
    handled.current = focusRequest.nonce;
    const desk = plan.desks.find((candidate) => candidate.agentId === focusRequest.agentId);
    if (desk === undefined) return;
    scroller.current?.scrollTo({ y: Math.max(0, (desk.y - 24) * plan.scale), animated: !still });
  }, [focusRequest, plan, still]);

  const members = useMemo(() => new Map(cast.map((member) => [member.id, member])), [cast]);
  const text = floorNote(model.agents.size, people.overflow);
  const dueId = visits[0]?.agentId ?? null;
  const dueDesk = plan?.desks.find((desk) => desk.agentId === dueId);
  return (
    <View style={styles.floor} onLayout={measure}>
      {plan === null ? null : (
        <ScrollView ref={scroller} style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.map}>
            <Room plan={plan} art={art} />
            <BoardButton at={plan.board} scale={plan.scale} styles={styles} onOpen={openBoard} />
            <Racks
              racks={plan.racks}
              note={note}
              busy={busy}
              art={art}
              scale={plan.scale}
              veil={styles.lit}
              onOpen={onOpenMachine}
            />
            {plan.plates.map((plate) => (
              <Fragment key={plate.id}>
                <Plate
                  plate={plate}
                  art={art}
                  scale={plan.scale}
                  styles={styles}
                  onOpen={onSelectBoard}
                />
                {plan.desks.map((desk) => {
                  const member = desk.teamId === plate.id ? members.get(desk.agentId) : undefined;
                  if (member === undefined) return null;
                  return (
                    <DeskView
                      key={desk.agentId}
                      desk={desk}
                      member={member}
                      label={labels.get(desk.agentId) ?? member.name}
                      serving={serving.has(desk.agentId)}
                      sheets={trays.get(desk.agentId)?.sheets ?? 0}
                      flag={trays.get(desk.agentId)?.flag ?? false}
                      art={art}
                      scale={plan.scale}
                      tagHeight={plan.tagHeight}
                      still={still}
                      styles={styles}
                      onSelect={onSelectAgent}
                    />
                  );
                })}
              </Fragment>
            ))}
            <Rocket at={plan.rocket} launch={launch} art={art} scale={plan.scale} still={still} />
            {janitor === null ? null : (
              <JanitorButton
                cart={plan.cart}
                note={janitor}
                art={art}
                scale={plan.scale}
                veil={styles.lit}
                onOpen={onOpenJanitor}
              />
            )}
            {plan.desks.map((desk) => {
              const member = members.get(desk.agentId);
              if (member === undefined) return null;
              const { place } = member.standing;
              const spot = place === null ? null : spotAt(plan.spots[place], member.spot);
              return (
                <PersonView
                  key={desk.agentId}
                  member={member}
                  desk={desk}
                  awayX={spot?.x ?? null}
                  awayY={spot?.y ?? null}
                  laneX={plan.laneX}
                  art={art}
                  scale={plan.scale}
                  still={still}
                  styles={styles}
                  onSelect={onSelectAgent}
                />
              );
            })}
            <JanitorView
              dueId={dueDesk === undefined ? null : dueDesk.agentId}
              dueX={dueDesk === undefined ? 0 : dueDesk.x + SIZE.desk.w - SIZE.person.w}
              dueY={dueDesk?.aisleY ?? 0}
              homeX={plan.janitor.x}
              homeY={plan.janitor.y}
              laneX={plan.laneX}
              art={art}
              scale={plan.scale}
              styles={styles}
              onSwept={swept}
            />
          </View>
          {text === null ? null : <Text style={styles.note}>{text}</Text>}
        </ScrollView>
      )}
    </View>
  );
}
