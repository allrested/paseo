// The office on the phone, composed from the host's pictures: backdrop tiles, one sprite per robot
// stepping through its frames, the front walls on top. Pan, pinch and taps are handled here, on
// the phone. Everything is a React Native primitive: the store app evaluates this bundle as it is.
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Animated,
  AppState,
  Easing,
  Image,
  PixelRatio,
  Platform,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import {
  sheetInputRpc,
  sheetSpriteRpc,
  sheetSubscription,
  type SheetEvent,
  type SheetInput,
} from "../../shared/contracts.js";
import {
  PLANE_KEY,
  type Sheet,
  type SheetPoint,
  type SheetRobot,
  type SheetTile,
  type SpritePicture,
} from "../../shared/sheet.js";
import { PLANE_MS } from "../scene/scene-plan.js";
import {
  KEEP_ALIVE_MS,
  resizeToSend,
  sizeAfterLayout,
  streamShown,
  type StreamViewProps,
} from "../scene/stream-view.js";
import {
  TAP_SLOP_PX,
  firstTransform,
  fitted,
  focusOn,
  layerStyleValues,
  panned,
  pinched,
  planePath,
  playsOnce,
  stepRanges,
  targetAt,
  type Fingers,
  type Transform,
  type Viewer,
} from "./sheet-motion.js";
import { INITIAL_SHEET, sheetReducer } from "./sheet-state.js";

const HOST_CLOSED = "the host closed the 3D view";
const LOADING = "Loading the 3D view...";
const JPEG_URI = "data:image/jpeg;base64,";
const PNG_URI = "data:image/png;base64,";
/** Animations run on the native thread where there is one, so a busy JS thread does not stall them. */
const NATIVE = Platform.OS !== "web";
const GLIDE_MS = 450;
const FADE_IN_MS = 300;
/** The plane's arc is drawn through this many points. */
const PLANE_STEPS = 8;

const CLIP = { overflow: "hidden" } as const;

/** The picture of a sprite, by `scale|key`: undefined while asked for, null when there is none. */
type Sprites = Record<string, SpritePicture | null>;

const spriteId = (scale: number, key: string) => `${scale}|${key}`;

/** A clock that runs while a sprite that needs it is shown, and is shared by all of that kind. */
function createClocks() {
  const clocks = new Map<
    string,
    { value: Animated.Value; users: number; loop: Animated.CompositeAnimation | null }
  >();
  const entry = (frames: number, frameMs: number) => {
    const id = `${frames}|${frameMs}`;
    let found = clocks.get(id);
    if (found === undefined) {
      found = { value: new Animated.Value(0), users: 0, loop: null };
      clocks.set(id, found);
    }
    return found;
  };
  return {
    value: (frames: number, frameMs: number) => entry(frames, frameMs).value,
    /** Returns the function that lets go of it. */
    use(frames: number, frameMs: number): () => void {
      const clock = entry(frames, frameMs);
      clock.users += 1;
      if (clock.loop === null) {
        clock.loop = Animated.loop(
          Animated.timing(clock.value, {
            toValue: frames,
            duration: frames * frameMs,
            easing: Easing.linear,
            useNativeDriver: NATIVE,
          }),
        );
        clock.loop.start();
      }
      return () => {
        clock.users -= 1;
        if (clock.users > 0) return;
        clock.loop?.stop();
        clock.loop = null;
      };
    },
  };
}
type Clocks = ReturnType<typeof createClocks>;

export function SheetView(props: StreamViewProps) {
  const { styles } = props;
  const [size, setSize] = useState<Viewer | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => sizeAfterLayout(previous, width, height));
  }, []);
  const [appState, setAppState] = useState<string>(() => AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  // A new theme is a new subscription: the host draws in the colours it was opened with.
  const themeKey = useMemo(() => Object.values(props.theme.colors).join("|"), [props.theme]);
  const sceneStyle = useMemo(() => [styles.scene, CLIP], [styles.scene]);
  return (
    <View style={sceneStyle} onLayout={onLayout}>
      {streamShown(size, appState) ? (
        <Session key={themeKey} size={size} {...props} />
      ) : (
        <Text style={styles.sceneStatus}>{LOADING}</Text>
      )}
    </View>
  );
}

function Session({
  size,
  theme,
  styles,
  focusRoomId,
  focusRequest,
  onSelectAgent,
  onSelectBoard,
  onProblem,
}: StreamViewProps & { size: Viewer }) {
  // The subscription opens at the first size; later sizes go to the host as a resize, because a
  // new subscription input would open a new page.
  const [input] = useState<SheetInput>(() => ({
    width: size.width,
    height: size.height,
    pixelRatio: PixelRatio.get(),
    colors: theme.colors,
  }));
  const [state, dispatch] = useReducer(sheetReducer, INITIAL_SHEET);
  const handlers = useRef({ onSelectAgent, onSelectBoard, onProblem });
  useEffect(() => {
    handlers.current = { onSelectAgent, onSelectBoard, onProblem };
  }, [onSelectAgent, onSelectBoard, onProblem]);

  const send = useRpc(sheetInputRpc);
  const requestSprite = useRpc(sheetSpriteRpc);
  const { sheetId, shown, problem } = state;
  const sheetIdRef = useRef<string | null>(null);

  const onEvent = useCallback((event: SheetEvent) => {
    dispatch(event);
    if (event.type === "problem") handlers.current.onProblem(event.message);
  }, []);
  const subscription = useSubscription(sheetSubscription, input, onEvent);
  const { status } = subscription;
  const failure = subscription.status === "error" ? subscription.error.message : null;
  useEffect(() => {
    if (failure !== null) handlers.current.onProblem(failure);
    // The host says why before it closes the view; a close with no reason is one too.
    else if (status === "closed" && problem === null) handlers.current.onProblem(HOST_CLOSED);
  }, [status, failure, problem]);

  // One call at a time would be tidier, but a resize or a keep-alive that is lost is reported
  // the same way whichever call it was.
  const lost = useRef(false);
  const fail = useCallback((reason: string) => {
    if (lost.current) return;
    lost.current = true;
    handlers.current.onProblem(reason);
  }, []);
  const tell = useCallback(
    (message: { sheetId: string; resize?: Viewer & { pixelRatio: number } }) => {
      void (async () => {
        try {
          const answer = await send(message);
          if (answer.ok) return;
          fail(HOST_CLOSED);
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [send, fail],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (sheetIdRef.current !== null) tell({ sheetId: sheetIdRef.current });
    }, KEEP_ALIVE_MS);
    return () => clearInterval(timer);
  }, [tell]);

  // Compared with the last size the host was told, not the opening one: turning the phone and
  // turning it back has to send the opening size again. A new sheet id, as after a reconnect, is
  // a new page at the opening size, so what the old one was told counts no more.
  const hostSize = useRef<Viewer & { sheetId: string | null }>({
    sheetId: null,
    width: input.width,
    height: input.height,
  });
  const { width, height } = size;
  useEffect(() => {
    sheetIdRef.current = sheetId;
    if (sheetId === null) return;
    if (hostSize.current.sheetId !== sheetId) {
      hostSize.current = { sheetId, width: input.width, height: input.height };
    }
    const next = resizeToSend(hostSize.current, { width, height });
    if (next === null) return;
    hostSize.current = { sheetId, ...next };
    tell({ sheetId, resize: { ...next, pixelRatio: input.pixelRatio } });
  }, [sheetId, width, height, input, tell]);

  // Sprites: asked for once per scale and key for as long as this page lives.
  const [sprites, setSprites] = useState<Sprites>({});
  const seenPosts = useRef<Set<string> | null>(null);
  const asked = useRef(new Set<string>());
  const scale = shown?.sheet.scale ?? null;
  useEffect(() => {
    asked.current.clear();
    setSprites({});
    seenPosts.current = null;
  }, [sheetId]);
  useEffect(() => {
    if (scale === null) return;
    const prefix = `${scale}|`;
    const own = (id: string) => id.startsWith(prefix);
    for (const id of asked.current) if (!own(id)) asked.current.delete(id);
    setSprites((previous) =>
      Object.keys(previous).every(own)
        ? previous
        : Object.fromEntries(Object.entries(previous).filter(([id]) => own(id))),
    );
  }, [scale]);
  const want = useCallback(
    (key: string) => {
      const id = spriteId(scale ?? 0, key);
      const page = sheetIdRef.current;
      if (scale === null || page === null || asked.current.has(id)) return;
      asked.current.add(id);
      const keep = (picture: SpritePicture | null) => {
        // An answer for a page that is gone, or a scale no longer shown, is not for this view.
        if (sheetIdRef.current !== page || !asked.current.has(id)) return;
        setSprites((previous) => ({ ...previous, [id]: picture }));
      };
      // A failed question is remembered as no picture: asking again in a loop helps nobody.
      requestSprite({ sheetId: page, key }).then(keep, () => keep(null));
    },
    [requestSprite, scale],
  );

  const sheet = shown?.sheet ?? null;
  const robots = sheet?.robots;
  useEffect(() => {
    if (robots === undefined) return;
    for (const robot of robots) want(robot.key);
  }, [robots, want]);

  // The sheet shown before this one: what a robot's key and presence are compared with.
  const history = useRef<{ sheet: Sheet | null; previous: Sheet | null }>({
    sheet: null,
    previous: null,
  });
  if (history.current.sheet !== sheet) {
    history.current = { sheet, previous: history.current.sheet };
  }
  const { previous } = history.current;
  const previousRobots = useMemo(
    () => new Map((previous?.robots ?? []).map((robot) => [robot.agentId, robot])),
    [previous],
  );

  // Mentions: the first sheet only records what is already there.
  const [planes, setPlanes] = useState<Array<{ id: number; from: SheetPoint; to: SheetPoint }>>([]);
  const planeId = useRef(0);
  const mentions = sheet?.mentions;
  useEffect(() => {
    if (mentions === undefined) return;
    if (seenPosts.current === null) {
      seenPosts.current = new Set(mentions.map((mention) => mention.postId));
      return;
    }
    const seen = seenPosts.current;
    const fresh = mentions.filter((mention) => !seen.has(mention.postId));
    if (fresh.length === 0) return;
    for (const mention of fresh) seen.add(mention.postId);
    want(PLANE_KEY);
    setPlanes((current) => [
      ...current,
      ...fresh.map(({ from, to }) => ({ id: (planeId.current += 1), from, to })),
    ]);
  }, [mentions, want]);
  const planePicture = scale === null ? undefined : sprites[spriteId(scale, PLANE_KEY)];
  useEffect(() => {
    if (planePicture === null) setPlanes([]);
  }, [planePicture]);
  const removePlane = useCallback(
    (id: number) => setPlanes((current) => current.filter((plane) => plane.id !== id)),
    [],
  );

  // The transform lives in three Animated values, written on every move without a render.
  const [layer] = useState(() => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    scale: new Animated.Value(1),
  }));
  const transform = useRef<Transform | null>(null);
  const viewer = useRef<Viewer>(size);
  const sheetNow = useRef<Sheet | null>(null);
  const initialRoom = useRef(focusRoomId);
  const glide = useRef<Animated.CompositeAnimation | null>(null);
  const place = useCallback(
    (next: Transform, forSheet: Sheet) => {
      transform.current = next;
      const values = layerStyleValues(next, forSheet);
      layer.x.setValue(values.translateX);
      layer.y.setValue(values.translateY);
      layer.scale.setValue(values.scale);
    },
    [layer],
  );
  // A new picture size, or a new viewer size, puts the picture back inside the viewer.
  const pictureWidth = sheet?.width;
  const pictureHeight = sheet?.height;
  const pictureRatio = sheet?.ratio;
  useLayoutEffect(() => {
    viewer.current = { width, height };
    sheetNow.current = sheet;
    if (sheet === null) return;
    glide.current?.stop();
    place(
      transform.current === null
        ? firstTransform(sheet, viewer.current, initialRoom.current)
        : fitted(transform.current, sheet, viewer.current),
      sheet,
    );
    // The sheet's other fields change often and do not move the picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictureWidth, pictureHeight, pictureRatio, width, height, sheet === null, place]);
  useEffect(() => {
    sheetNow.current = sheet;
  }, [sheet]);

  const glideTo = useCallback(
    (to: Transform | null) => {
      const current = sheetNow.current;
      if (to === null || current === null) return;
      glide.current?.stop();
      // The target is the state from here on: a touch during the glide continues from it.
      transform.current = to;
      const values = layerStyleValues(to, current);
      const move = (value: Animated.Value, toValue: number) =>
        Animated.timing(value, { toValue, duration: GLIDE_MS, useNativeDriver: NATIVE });
      glide.current = Animated.parallel([
        move(layer.x, values.translateX),
        move(layer.y, values.translateY),
        move(layer.scale, values.scale),
      ]);
      glide.current.start();
    },
    [layer],
  );
  useEffect(() => () => glide.current?.stop(), []);

  // A request that was already there when this view appeared was made for the structure view.
  const handledNonce = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handledNonce.current) return;
    handledNonce.current = focusRequest.nonce;
    const current = sheetNow.current;
    if (current === null || transform.current === null) return;
    glideTo(focusOn(current, { agentId: focusRequest.agentId }, viewer.current, transform.current));
  }, [focusRequest, glideTo]);

  // Touches are read against this view, so the content never takes them (`pointerEvents` below).
  const hold = useRef<{
    start: SheetPoint;
    last: SheetPoint;
    fingers: Fingers | null;
    moved: boolean;
    joined: boolean;
  } | null>(null);
  const responder = useMemo(() => {
    const points = (event: GestureResponderEvent) =>
      event.nativeEvent.touches.map(({ locationX, locationY }) => ({ x: locationX, y: locationY }));
    const spread = (a: SheetPoint, b: SheetPoint): Fingers => ({
      spread: Math.hypot(a.x - b.x, a.y - b.y),
      middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    });
    const apply = (next: Transform) => {
      const current = sheetNow.current;
      if (current !== null) place(fitted(next, current, viewer.current), current);
    };
    const tap = (at: SheetPoint) => {
      const current = sheetNow.current;
      if (current === null || transform.current === null) return;
      const target = targetAt(current, transform.current, at);
      if (target === null) return;
      if ("agentId" in target) handlers.current.onSelectAgent(target.agentId);
      else if ("boardId" in target) handlers.current.onSelectBoard(target.boardId);
      else glideTo(focusOn(current, target, viewer.current, transform.current));
    };
    return {
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      // Once a drag has started it stays here; a parent that asks for it is refused.
      onResponderTerminationRequest: () => false,
      onResponderGrant: (event: GestureResponderEvent) => {
        // A touch takes over from a glide where it was headed.
        glide.current?.stop();
        const [first, second] = points(event);
        if (first === undefined) return;
        hold.current = {
          start: first,
          last: first,
          fingers: second === undefined ? null : spread(first, second),
          moved: false,
          joined: second !== undefined,
        };
      },
      onResponderMove: (event: GestureResponderEvent) => {
        const current = hold.current;
        const [first, second] = points(event);
        if (current === null || first === undefined || transform.current === null) return;
        if (second !== undefined) {
          const now = spread(first, second);
          current.joined = true;
          if (current.fingers !== null) apply(pinched(transform.current, current.fingers, now));
          current.fingers = now;
          return;
        }
        // One finger again after two: carry on from where it is, without a jump.
        if (current.fingers !== null) {
          current.fingers = null;
          current.last = first;
          return;
        }
        if (!current.moved) {
          if (Math.hypot(first.x - current.start.x, first.y - current.start.y) <= TAP_SLOP_PX) {
            return;
          }
          current.moved = true;
        }
        apply(panned(transform.current, first.x - current.last.x, first.y - current.last.y));
        current.last = first;
      },
      onResponderRelease: () => {
        const current = hold.current;
        hold.current = null;
        if (current !== null && !current.moved && !current.joined) tap(current.start);
      },
      onResponderTerminate: () => {
        hold.current = null;
      },
    };
  }, [glideTo, place]);

  const touchStyle = useMemo(() => [styles.streamTouch, CLIP], [styles.streamTouch]);
  const contentStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: 0,
      top: 0,
      width: pictureWidth,
      height: pictureHeight,
      transform: [{ translateX: layer.x }, { translateY: layer.y }, { scale: layer.scale }],
    }),
    [pictureWidth, pictureHeight, layer],
  );
  const clocks = useState(createClocks)[0];
  const tiles = shown?.tiles;
  const layers = useMemo(() => (tiles === undefined ? null : tileLayers(tiles)), [tiles]);

  return (
    <View
      style={touchStyle}
      accessibilityRole="image"
      accessibilityLabel="Office in 3D"
      {...responder}
    >
      {sheet === null || layers === null ? (
        <Text style={styles.sceneStatus}>{LOADING}</Text>
      ) : (
        <Animated.View pointerEvents="none" style={contentStyle}>
          {layers.backdrop}
          {sheet.robots.map((robot) => (
            <RobotSprite
              key={robot.agentId}
              sheet={sheet}
              robot={robot}
              previous={previousRobots.get(robot.agentId)}
              fadesIn={previous !== null && !previousRobots.has(robot.agentId)}
              picture={sprites[spriteId(sheet.scale, robot.key)]}
              clocks={clocks}
            />
          ))}
          {layers.overlay}
          {planePicture === undefined || planePicture === null
            ? null
            : planes.map((plane) => (
                <Plane
                  key={plane.id}
                  sheet={sheet}
                  picture={planePicture}
                  from={plane.from}
                  to={plane.to}
                  id={plane.id}
                  onDone={removePlane}
                />
              ))}
        </Animated.View>
      )}
    </View>
  );
}

/** The tiles as images, made once per backdrop so they are not reloaded for every sheet. */
function tileLayers(tiles: SheetTile[]) {
  const parts = tiles.map((tile) => ({
    key: `${tile.version}:${tile.index}`,
    style: {
      position: "absolute" as const,
      left: tile.x,
      top: tile.y,
      width: tile.width,
      height: tile.height,
    },
    backdrop: { uri: `${JPEG_URI}${tile.jpeg}` },
    overlay: tile.overlay === null ? null : { uri: `${PNG_URI}${tile.overlay}` },
  }));
  return {
    backdrop: parts.map((part) => (
      <Image key={part.key} source={part.backdrop} style={part.style} fadeDuration={0} />
    )),
    overlay: parts.map((part) =>
      part.overlay === null ? null : (
        <Image key={part.key} source={part.overlay} style={part.style} fadeDuration={0} />
      ),
    ),
  };
}

interface RobotSpriteProps {
  sheet: Sheet;
  robot: SheetRobot;
  /** The robot in the sheet shown before this one. */
  previous: SheetRobot | undefined;
  fadesIn: boolean;
  clocks: Clocks;
}

/** A robot is not drawn until its picture is here: undefined while the host is still asked. */
const RobotSprite = memo(function RobotSprite({
  picture,
  ...rest
}: RobotSpriteProps & { picture: SpritePicture | null | undefined }) {
  return picture == null ? null : <ShownRobot picture={picture} {...rest} />;
});

function ShownRobot({
  sheet,
  robot,
  previous,
  fadesIn,
  picture,
  clocks,
}: RobotSpriteProps & { picture: SpritePicture }) {
  const { frames, frameMs } = picture;
  const fade = useRef(new Animated.Value(fadesIn ? 0 : 1)).current;
  useEffect(() => {
    if (!fadesIn) return;
    Animated.timing(fade, {
      toValue: 1,
      duration: FADE_IN_MS,
      useNativeDriver: NATIVE,
    }).start();
    // Only a robot that arrives fades; the flag is read when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loops = picture.loop && frames > 1;
  const once = !picture.loop && frames > 1;
  const plays = playsOnce(previous, robot, picture.loop);
  // A once-only sprite sits on its last frame unless it plays now.
  const onceValue = useRef(new Animated.Value(plays ? 0 : frames)).current;
  const wave = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (!once || !plays) return;
    wave.current?.stop();
    onceValue.setValue(0);
    wave.current = Animated.timing(onceValue, {
      toValue: frames,
      duration: frames * frameMs,
      easing: Easing.linear,
      useNativeDriver: NATIVE,
    });
    wave.current.start();
    // A sheet that repeats the key gives `plays` false and leaves a running wave alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot, once]);
  useEffect(() => () => wave.current?.stop(), []);
  useEffect(
    () => (loops ? clocks.use(frames, frameMs) : undefined),
    [clocks, loops, frames, frameMs],
  );

  const source = useMemo(() => ({ uri: `${PNG_URI}${picture.png}` }), [picture]);
  const step = useMemo(() => {
    if (!loops && !once) return null;
    const ranges = stepRanges(picture);
    const position = loops
      ? Animated.modulo(Animated.add(clocks.value(frames, frameMs), robot.phase), frames)
      : onceValue;
    const along = (output: number[]) =>
      position.interpolate({ inputRange: ranges.input, outputRange: output, extrapolate: "clamp" });
    return { x: along(ranges.x), y: along(ranges.y) };
  }, [picture, loops, once, clocks, frames, frameMs, robot.phase, onceValue]);

  const grid = useMemo(
    () => ({
      position: "absolute" as const,
      left: 0,
      top: 0,
      width: picture.columns * picture.frameWidth,
      height: Math.ceil(frames / picture.columns) * picture.frameHeight,
    }),
    [picture, frames],
  );
  const stepStyle = useMemo(
    () =>
      step === null
        ? null
        : [grid, { transform: [{ translateX: step.x }, { translateY: step.y }] }],
    [grid, step],
  );
  const clipStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: robot.x,
      top: robot.y,
      width: sheet.frame.width,
      height: sheet.frame.height,
      overflow: "hidden" as const,
      opacity: fade,
    }),
    [robot.x, robot.y, sheet.frame.width, sheet.frame.height, fade],
  );
  return (
    <Animated.View style={clipStyle}>
      {stepStyle === null ? (
        <Image source={source} style={grid} fadeDuration={0} />
      ) : (
        <Animated.Image source={source} style={stepStyle} fadeDuration={0} />
      )}
    </Animated.View>
  );
}

function Plane({
  sheet,
  picture,
  from,
  to,
  id,
  onDone,
}: {
  sheet: Sheet;
  picture: SpritePicture;
  from: SheetPoint;
  to: SheetPoint;
  id: number;
  onDone(id: number): void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const flight = Animated.timing(progress, {
      toValue: 1,
      duration: PLANE_MS,
      easing: Easing.linear,
      useNativeDriver: NATIVE,
    });
    flight.start(({ finished }) => {
      if (finished) onDoneRef.current(id);
    });
    return () => flight.stop();
  }, [progress, id]);
  const source = useMemo(() => ({ uri: `${PNG_URI}${picture.png}` }), [picture]);
  const { scale } = sheet;
  const { width: frameWidth, height: frameHeight } = sheet.frame;
  const { x: chestX, y: chestY } = sheet.frame.chest;
  const flightStyle = useMemo(() => {
    const path = planePath(from, to, scale);
    const steps = Array.from({ length: PLANE_STEPS + 1 }, (_, index) => index / PLANE_STEPS);
    // The plane's chest point is what travels, lifted by an arc that is highest in the middle.
    const at = (t: number, axis: "x" | "y") =>
      from[axis] + (to[axis] - from[axis]) * t - (axis === "x" ? chestX : chestY);
    const lift = (t: number) => 4 * path.arc * t * (1 - t);
    return {
      position: "absolute" as const,
      left: 0,
      top: 0,
      width: frameWidth,
      height: frameHeight,
      overflow: "hidden" as const,
      transform: [
        {
          translateX: progress.interpolate({
            inputRange: steps,
            outputRange: steps.map((t) => at(t, "x")),
          }),
        },
        {
          translateY: progress.interpolate({
            inputRange: steps,
            outputRange: steps.map((t) => at(t, "y") - lift(t)),
          }),
        },
        { rotate: `${path.angle}deg` },
      ],
    };
  }, [progress, from, to, frameWidth, frameHeight, chestX, chestY, scale]);
  const gridStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: 0,
      top: 0,
      width: picture.columns * picture.frameWidth,
      height: Math.ceil(picture.frames / picture.columns) * picture.frameHeight,
    }),
    [picture],
  );
  return (
    <Animated.View style={flightStyle}>
      <Image source={source} style={gridStyle} fadeDuration={0} />
    </Animated.View>
  );
}
