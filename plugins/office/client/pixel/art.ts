// The 2D office's pictures. Small ones are written as grids, a letter per pixel; wide furniture
// is painted with rectangles into a grid first. Everything is compiled once per tone set.
import { CLEAR, compileSprite, type Sprite } from "./sprite.js";

/** The colours of the room and its furniture, by day (a light theme) and by night (a dark one). */
export interface Tones {
  floor: string;
  floorLine: string;
  rug: string;
  wall: string;
  wallTop: string;
  baseboard: string;
  wood: string;
  woodDark: string;
  woodLight: string;
  metal: string;
  metalDark: string;
  metalLight: string;
  screen: string;
  paper: string;
  /** Every second sheet of a stack. */
  paperShade: string;
  ink: string;
  plant: string;
  plantDark: string;
  pot: string;
  fabric: string;
  fabricDark: string;
  chair: string;
  chairDark: string;
  shadow: string;
  /** Text on the floor: a name tag, a team's plate, the note under the room. */
  text: string;
  textMuted: string;
  /** What every person wears below the shirt. */
  trousers: string;
  shoes: string;
  /** Over what a pointer or a finger is on: a thin veil, and a plate's own lit tone. */
  veil: string;
  plateLit: string;
}

export const DAY: Tones = {
  floor: "#E8E2D7",
  floorLine: "#DCD5C8",
  rug: "#D5DDE6",
  wall: "#CFC6B7",
  wallTop: "#B9AE9D",
  baseboard: "#A39784",
  wood: "#C99A68",
  woodDark: "#A87B4C",
  woodLight: "#DDB483",
  metal: "#5C6470",
  metalDark: "#3E454F",
  metalLight: "#8A929E",
  screen: "#18212C",
  paper: "#F8F6F0",
  paperShade: "#DDD8CC",
  ink: "#3A3F47",
  plant: "#4F9E5E",
  plantDark: "#377846",
  pot: "#B66D4C",
  fabric: "#6F87B9",
  fabricDark: "#566D9D",
  chair: "#474E59",
  chairDark: "#343A43",
  shadow: "#CFC8BB",
  text: "#2E3238",
  // 4.9:1 on a plate, the darkest ground it is read on.
  textMuted: "#4A4F59",
  trousers: "#3B4250",
  shoes: "#23272E",
  veil: "rgba(46, 50, 56, 0.1)",
  plateLit: "#DCD6CA",
};

export const NIGHT: Tones = {
  floor: "#2B2E35",
  floorLine: "#262930",
  rug: "#2A3442",
  wall: "#24272D",
  wallTop: "#1A1C21",
  baseboard: "#15171B",
  wood: "#8D6C49",
  woodDark: "#6C5237",
  woodLight: "#A5825B",
  metal: "#5A6270",
  metalDark: "#454C58",
  metalLight: "#7E8896",
  screen: "#0E141C",
  paper: "#DAD7CF",
  paperShade: "#B9B6AE",
  ink: "#2B2F36",
  plant: "#3E7F4B",
  plantDark: "#2B5E37",
  pot: "#8E563D",
  fabric: "#51648D",
  fabricDark: "#3F5075",
  chair: "#586170",
  chairDark: "#464E5B",
  shadow: "#22252B",
  text: "#E6E3DC",
  textMuted: "#A7ACB5",
  trousers: "#66708A",
  shoes: "#B9BEC8",
  veil: "rgba(230, 227, 220, 0.12)",
  plateLit: "#343841",
};

/** Lamps and screens glow the same by day and by night. */
export const LIGHT = {
  green: "#4FD08A",
  blue: "#6AAEFF",
  amber: "#F2B544",
  red: "#FF6B6B",
  dim: "#566070",
} as const;

/** A person's look: one of each, picked by the agent's id. */
export const SKINS = [
  { skin: "#F2C9A5", shade: "#DDAE86" },
  { skin: "#DBA57B", shade: "#C48C63" },
  { skin: "#A9764F", shade: "#8F603E" },
] as const;
export const HAIRS = [
  { hair: "#2B2B33", shade: "#1D1D24" },
  { hair: "#5B3C27", shade: "#44291A" },
  { hair: "#B97A3B", shade: "#9A6129" },
  { hair: "#D9C279", shade: "#BEA65C" },
  { hair: "#8F3030", shade: "#742222" },
  { hair: "#70707C", shade: "#585863" },
] as const;
/**
 * Shirts, and the bar on a person's name tag. Each has a luminance of 0.2, the narrow band that
 * is 3.2:1 on the day floor and on the night floor alike.
 */
export const SHIRTS = [
  { shirt: "#DA494E", shade: "#B63D41" },
  { shirt: "#B76724", shade: "#98561E" },
  { shirt: "#2A8D58", shade: "#237549" },
  { shirt: "#208892", shade: "#1B7179" },
  { shirt: "#3D7AD8", shade: "#3366B4" },
  { shirt: "#8265E8", shade: "#6C55C1" },
  { shirt: "#C15499", shade: "#A1467F" },
  { shirt: "#8C7C2D", shade: "#746625" },
] as const;

export interface Look {
  skin: number;
  hair: number;
  shirt: number;
}

/** A stable look from an id: the same agent looks the same on every device. */
export function lookOf(id: string): Look {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  return {
    skin: hash % SKINS.length,
    hair: (hash >>> 4) % HAIRS.length,
    shirt: (hash >>> 9) % SHIRTS.length,
  };
}

const PERSON_W = 12;

const HEAD_FRONT = [
  "...hhhhhh...",
  "..hhhhhhhh..",
  "..hhhhhhhh..",
  "..hhsssshh..",
  "..hsessesh..",
  "..ssssssss..",
  "...SssssS...",
];
const HEAD_BACK = [
  "...hhhhhh...",
  "..hhhhhhhh..",
  "..hhhhhhhh..",
  "..hhhhhhhh..",
  "..hhhhhhhh..",
  "..HhhhhhhH..",
  "...SssssS...",
];
const BODY = ["...cccccc...", "..cccccccc..", "..sccccccs..", "...cccccc...", "...CCCCCC..."];
const LEGS_STAND = ["...pppppp...", "...pp..pp...", "...pp..pp...", "...bb..bb..."];
const LEGS_STEP_A = ["...pppppp...", "...pp..pp...", "..pp...pp...", "..bb...bb..."];
const LEGS_STEP_B = ["...pppppp...", "...pp..pp...", "...pp...pp..", "...bb...bb.."];
// Seen from behind at a desk: the shoulders over a chair's back.
const SEATED = ["..cccccccc..", ".kkkkkkkkkk.", ".kKKKKKKKKk.", ".kkkkkkkkkk.", "..k......k.."];
const CHAIR = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  ".kkkkkkkkkk.",
  ".kKKKKKKKKk.",
  ".kkkkkkkkkk.",
  "..k......k..",
];

export type Pose = "front" | "frontA" | "frontB" | "back" | "backA" | "backB" | "seated";

const POSES: Readonly<Record<Pose, readonly string[]>> = {
  front: [...HEAD_FRONT, ...BODY, ...LEGS_STAND],
  frontA: [...HEAD_FRONT, ...BODY, ...LEGS_STEP_A],
  frontB: [...HEAD_FRONT, ...BODY, ...LEGS_STEP_B],
  back: [...HEAD_BACK, ...BODY, ...LEGS_STAND],
  backA: [...HEAD_BACK, ...BODY, ...LEGS_STEP_A],
  backB: [...HEAD_BACK, ...BODY, ...LEGS_STEP_B],
  seated: [...HEAD_BACK, ...SEATED],
};

/** A grid of clear pixels to paint rectangles into. */
function canvas(width: number, height: number) {
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => CLEAR));
  return {
    /** Fills a rectangle; what falls outside the grid is dropped. */
    fill(x: number, y: number, w: number, h: number, letter: string) {
      for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1) {
        for (let column = Math.max(0, x); column < Math.min(width, x + w); column += 1) {
          const line = rows[row];
          if (line) line[column] = letter;
        }
      }
      return this;
    },
    grid: () => rows.map((row) => row.join("")),
  };
}

const BOOKS = "rbgayrgbyabgrybagrbygabr";

function shelvesGrid(): string[] {
  const art = canvas(60, 26);
  art.fill(0, 0, 60, 26, "W").fill(1, 1, 58, 24, "d");
  let book = 0;
  for (const shelf of [2, 10, 18]) {
    art.fill(1, shelf + 6, 58, 1, "w");
    let x = 2;
    while (x < 57) {
      const letter = BOOKS[book % BOOKS.length] ?? "r";
      // Widths 2 and 3 and heights 4 to 6, in a fixed order: shelves that look used, the same
      // on every device.
      const width = 2 + ((book * 7) % 3 === 0 ? 1 : 0);
      const height = 4 + ((book * 5) % 3);
      if (x + width > 57) break;
      if (book % 9 !== 7) art.fill(x, shelf + 6 - height, width, height, letter);
      x += width + (book % 4 === 3 ? 1 : 0);
      book += 1;
    }
  }
  return art.grid();
}

function boardGrid(): string[] {
  return canvas(44, 20)
    .fill(0, 0, 44, 18, "m")
    .fill(1, 1, 42, 16, "p")
    .fill(4, 4, 14, 1, "i")
    .fill(4, 7, 22, 1, "b")
    .fill(4, 10, 10, 1, "i")
    .fill(4, 13, 17, 1, "r")
    .fill(30, 4, 9, 6, "y")
    .fill(12, 18, 20, 2, "M")
    .grid();
}

/** One rack; `lit` moves two of its lamps, so a pair of frames makes them blink. */
function rackGrid(lit: boolean): string[] {
  const art = canvas(14, 26).fill(0, 0, 14, 26, "M").fill(1, 1, 12, 24, "m");
  for (let slot = 0; slot < 5; slot += 1) {
    const y = 3 + slot * 4;
    art.fill(2, y, 10, 3, "M").fill(3, y + 1, 4, 1, "l");
    const on = lit ? slot % 2 === 0 : slot % 2 === 1;
    art.fill(9, y + 1, 1, 1, on ? "g" : "l").fill(11, y + 1, 1, 1, slot === 3 ? "a" : "g");
  }
  return art.grid();
}

function deskGrid(): string[] {
  return canvas(30, 18)
    .fill(8, 0, 14, 9, "M")
    .fill(13, 9, 4, 2, "M")
    .fill(0, 10, 30, 5, "w")
    .fill(0, 10, 30, 1, "L")
    .fill(13, 10, 4, 1, "M")
    .fill(9, 12, 12, 2, "l")
    .fill(0, 15, 30, 2, "W")
    .fill(1, 17, 2, 1, "W")
    .fill(27, 17, 2, 1, "W")
    .grid();
}

function sofaGrid(): string[] {
  return canvas(30, 14)
    .fill(0, 0, 30, 6, "F")
    .fill(1, 1, 28, 4, "f")
    .fill(0, 5, 4, 8, "F")
    .fill(26, 5, 4, 8, "F")
    .fill(4, 6, 22, 6, "f")
    .fill(14, 6, 1, 6, "F")
    .fill(4, 12, 22, 1, "F")
    .fill(1, 13, 2, 1, "i")
    .fill(27, 13, 2, 1, "i")
    .grid();
}

function coffeeGrid(): string[] {
  return canvas(12, 18)
    .fill(1, 0, 10, 12, "M")
    .fill(2, 1, 8, 3, "m")
    .fill(3, 2, 2, 1, "g")
    .fill(7, 2, 2, 1, "a")
    .fill(3, 5, 6, 5, "i")
    .fill(5, 7, 2, 3, "p")
    .fill(0, 12, 12, 4, "w")
    .fill(0, 12, 12, 1, "L")
    .fill(0, 16, 12, 2, "W")
    .grid();
}

function plantGrid(): string[] {
  return canvas(10, 16)
    .fill(3, 0, 4, 2, "g")
    .fill(1, 2, 8, 5, "g")
    .fill(0, 4, 10, 3, "g")
    .fill(2, 3, 2, 3, "G")
    .fill(6, 5, 3, 2, "G")
    .fill(4, 7, 2, 3, "G")
    .fill(2, 10, 6, 2, "o")
    .fill(3, 12, 4, 4, "o")
    .grid();
}

/** The rocket alone: it leaves its pad behind. */
function rocketGrid(): string[] {
  return canvas(14, 22)
    .fill(6, 0, 2, 2, "r")
    .fill(5, 2, 4, 2, "r")
    .fill(4, 4, 6, 14, "p")
    .fill(8, 4, 2, 14, "s")
    .fill(5, 7, 4, 4, "M")
    .fill(6, 8, 2, 2, "b")
    .fill(4, 16, 6, 2, "r")
    .fill(2, 14, 2, 6, "r")
    .fill(10, 14, 2, 6, "r")
    .fill(5, 18, 4, 2, "M")
    .grid();
}

function padGrid(): string[] {
  return canvas(14, 4).fill(0, 0, 14, 2, "m").fill(1, 2, 12, 2, "M").grid();
}

/** A server an agent left listening: a small box on its desk with a lamp. */
function serverGrid(): string[] {
  return canvas(6, 8)
    .fill(0, 0, 6, 8, "M")
    .fill(1, 1, 4, 6, "m")
    .fill(1, 3, 4, 1, "M")
    .fill(1, 5, 4, 1, "M")
    .fill(4, 2, 1, 1, "g")
    .grid();
}

/**
 * The tray on a desk: a dark tray, a row of paper for each level, and a flag in a stack that
 * is nearly full. The paper is the agent's context. White paper is 2.3:1 on a desk by day, so
 * the tray's dark sides are what sets it off. A full tray with its flag is six pixels tall and
 * the flag stands at its left: the bubble beside the screen ends just over it.
 */
function trayGrid(sheets: number, flag: boolean): string[] {
  const art = canvas(6, 10).fill(0, 9, 6, 1, "M");
  if (sheets > 0) art.fill(0, 9 - sheets, 6, sheets, "M");
  for (let row = 0; row < sheets; row += 1) {
    art.fill(1, 8 - row, 4, 1, row % 2 === 0 ? "p" : "P");
  }
  if (flag) art.fill(1, 6 - sheets, 1, 3, "l").fill(2, 6 - sheets, 2, 2, "R");
  return art.grid();
}

/** The janitor's cart: a bucket on wheels with a mop standing in it. */
function cartGrid(): string[] {
  return canvas(12, 16)
    .fill(8, 0, 1, 8, "h")
    .fill(0, 7, 11, 1, "M")
    .fill(1, 8, 9, 6, "c")
    .fill(1, 12, 9, 2, "C")
    .fill(1, 14, 2, 2, "M")
    .fill(8, 14, 2, 2, "M")
    .grid();
}

/** The janitor's broom, carried upright beside the body. */
function broomGrid(): string[] {
  return canvas(3, 14).fill(1, 0, 1, 11, "h").fill(0, 11, 3, 3, "c").grid();
}

function flameGrid(): string[] {
  return canvas(6, 8).fill(1, 0, 4, 3, "a").fill(2, 3, 2, 3, "a").fill(2, 0, 2, 2, "y").grid();
}

/** What a screen shows: nothing, code going by (two frames), a question, an error. */
export type ScreenKind = "off" | "codeA" | "codeB" | "wait" | "fail";

const SCREENS: Readonly<Record<ScreenKind, readonly string[]>> = {
  off: canvas(12, 7).fill(0, 0, 12, 7, "s").fill(1, 5, 1, 1, "l").grid(),
  codeA: canvas(12, 7)
    .fill(0, 0, 12, 7, "s")
    .fill(1, 1, 5, 1, "g")
    .fill(2, 3, 7, 1, "b")
    .fill(2, 5, 4, 1, "g")
    .grid(),
  codeB: canvas(12, 7)
    .fill(0, 0, 12, 7, "s")
    .fill(1, 1, 7, 1, "b")
    .fill(2, 3, 4, 1, "g")
    .fill(1, 5, 6, 1, "g")
    .fill(8, 5, 1, 1, "p")
    .grid(),
  wait: canvas(12, 7).fill(0, 0, 12, 7, "s").fill(3, 1, 6, 5, "a").fill(5, 2, 2, 3, "s").grid(),
  fail: canvas(12, 7).fill(0, 0, 12, 7, "r").fill(5, 1, 2, 3, "p").fill(5, 5, 2, 1, "p").grid(),
};

/** What a person is at, as a picture over the head. */
export const ICONS = {
  read: [
    "........",
    ".ii..ii.",
    "ippiippi",
    "ippiippi",
    "ippiippi",
    "ippiippi",
    ".iiiiii.",
    "........",
  ],
  search: [
    "..iii...",
    ".i...i..",
    "i.....i.",
    "i.....i.",
    ".i...i..",
    "..iiii..",
    ".....ii.",
    "......ii",
  ],
  edit: [
    "......ii",
    ".....iai",
    "....iaai",
    "...iaai.",
    "..iaai..",
    ".iaai...",
    ".iii....",
    "ii......",
  ],
  command: [
    "........",
    "i.......",
    ".i......",
    "..i.....",
    ".i......",
    "i...iiii",
    "........",
    "........",
  ],
  test: [
    "..iiii..",
    "...ii...",
    "...ii...",
    "..i..i..",
    ".iggggi.",
    ".iggggi.",
    "iggggggi",
    "iiiiiiii",
  ],
  passed: [
    "........",
    ".......g",
    "......gg",
    "g....gg.",
    "gg..gg..",
    ".gggg...",
    "..gg....",
    "........",
  ],
  failed: [
    "r......r",
    "rr....rr",
    ".rr..rr.",
    "..rrrr..",
    "..rrrr..",
    ".rr..rr.",
    "rr....rr",
    "r......r",
  ],
  web: [
    "..iiii..",
    ".ibiibi.",
    "ibbibbbi",
    "iiiiiiii",
    "ibbibbbi",
    "ibbibbbi",
    ".ibiibi.",
    "..iiii..",
  ],
  tool: [
    "..i..i..",
    "..i..i..",
    ".iiiiii.",
    ".iiiiii.",
    ".iiiiii.",
    "..iiii..",
    "...ii...",
    "...ii...",
  ],
  plan: [
    "iiiiiiii",
    "i......i",
    "i.ii.i.i",
    "i......i",
    "i.ii.i.i",
    "i......i",
    "i.ii.i.i",
    "iiiiiiii",
  ],
  subagent: [
    "..ii....",
    "..ii....",
    ".iiii...",
    ".iiii.bb",
    "......bb",
    ".....bbb",
    ".....bbb",
    "........",
  ],
  commit: [
    "........",
    "..iiii..",
    ".i....i.",
    ".i.gg.i.",
    ".i.gg.i.",
    ".i....i.",
    "..iiii..",
    "........",
  ],
  ship: [
    "...bb...",
    "..bbbb..",
    ".bbbbbb.",
    "...bb...",
    "...bb...",
    "...bb...",
    "........",
    "iiiiiiii",
  ],
  coffee: [
    "..i..i..",
    ".i..i...",
    "........",
    "iiiiii..",
    "ippppiii",
    "ippppi.i",
    "ippppiii",
    ".iiii...",
  ],
  wait: [
    "..aaaa..",
    ".aa..aa.",
    ".....aa.",
    "....aa..",
    "...aa...",
    "........",
    "...aa...",
    "...aa...",
  ],
  fail: [
    "...rr...",
    "...rr...",
    "...rr...",
    "...rr...",
    "...rr...",
    "........",
    "...rr...",
    "...rr...",
  ],
  alert: [
    "...aa...",
    "...aa...",
    "...aa...",
    "...aa...",
    "...aa...",
    "........",
    "...aa...",
    "...aa...",
  ],
} as const;

export type IconKind = keyof typeof ICONS;

/** A speech bubble that holds one icon: 12 by 14, the last two rows its tail. */
const BUBBLE = canvas(12, 14)
  .fill(1, 0, 10, 12, "i")
  .fill(0, 1, 12, 10, "i")
  .fill(1, 1, 10, 10, "p")
  .fill(5, 12, 2, 1, "i")
  .fill(5, 11, 2, 1, "p")
  .fill(5, 13, 1, 1, "i")
  .grid();

export interface Art {
  tones: Tones;
  person(look: Look, pose: Pose): Sprite;
  chair: Sprite;
  desk: Sprite;
  screen(kind: ScreenKind): Sprite;
  shelves: Sprite;
  board: Sprite;
  /** Two frames: the lamps blink between them. */
  rack: readonly [Sprite, Sprite];
  sofa: Sprite;
  coffee: Sprite;
  plant: Sprite;
  rocket: Sprite;
  /** What the rocket stands on, under it. */
  pad: Sprite;
  flame: Sprite;
  /** The paper on a desk, by its level (0 to 3); a flag stands in a stack that is nearly full. */
  tray(sheets: number, flag: boolean): Sprite;
  cart: Sprite;
  /** The janitor: grey overalls and a yellow cap, the same in every pose. */
  janitor(pose: Pose): Sprite;
  broom: Sprite;
  server: Sprite;
  bubble: Sprite;
  icon(kind: IconKind): Sprite;
  /** The board's mark on a team's plate: it lies on the floor, so it is in the floor's ink. */
  plateMark: Sprite;
}

/** Builds each picture the first time it is asked for. */
function lazily<K extends string>(make: (key: K) => Sprite): (key: K) => Sprite {
  const made = new Map<K, Sprite>();
  return (key) => {
    let sprite = made.get(key);
    if (sprite === undefined) {
      sprite = make(key);
      made.set(key, sprite);
    }
    return sprite;
  };
}

function buildArt(tones: Tones): Art {
  const furniture = {
    w: tones.wood,
    W: tones.woodDark,
    L: tones.woodLight,
    d: tones.woodDark,
    m: tones.metal,
    M: tones.metalDark,
    l: tones.metalLight,
    s: tones.screen,
    p: tones.paper,
    i: tones.ink,
    f: tones.fabric,
    F: tones.fabricDark,
    o: tones.pot,
    P: tones.paperShade,
    g: LIGHT.green,
    b: LIGHT.blue,
    a: LIGHT.amber,
    y: "#F4DC7A",
    r: LIGHT.red,
  };
  // The cleaning things and the flag have the shirts' luminance of 0.2: 3.2:1 on both floors.
  const cleaning = { ...furniture, c: "#B76724", C: "#98561E", h: "#8C7C2D", R: "#DA494E" };
  // Overalls of the same luminance, so the janitor reads on both floors as everyone does.
  const janitorTones = {
    h: "#E3AE2B",
    H: "#C0901D",
    s: SKINS[1].skin,
    S: SKINS[1].shade,
    e: "#2B2B33",
    c: "#757B86",
    C: "#626873",
    p: "#757B86",
    b: tones.shoes,
  };
  const people = new Map<string, Sprite>();
  const chairTones = { k: tones.chair, K: tones.chairDark };
  const screenTones = { ...furniture, l: LIGHT.dim };
  const iconTones = {
    i: "#3A3F47",
    p: "#F8F6F0",
    // Each ink is 3:1 or more on the bubble's paper.
    g: "#2E9C61",
    r: "#D8484D",
    a: "#B77E19",
    b: "#3F7FE0",
  };
  const trays = lazily((key: string) =>
    compileSprite(trayGrid(Number(key[0]), key.endsWith("f")), cleaning),
  );
  return {
    tones,
    person(look, pose) {
      const key = `${look.skin}:${look.hair}:${look.shirt}:${pose}`;
      const known = people.get(key);
      if (known) return known;
      const skin = SKINS[look.skin] ?? SKINS[0];
      const hair = HAIRS[look.hair] ?? HAIRS[0];
      const shirt = SHIRTS[look.shirt] ?? SHIRTS[0];
      const sprite = compileSprite(POSES[pose], {
        h: hair.hair,
        H: hair.shade,
        s: skin.skin,
        S: skin.shade,
        e: "#2B2B33",
        c: shirt.shirt,
        C: shirt.shade,
        p: tones.trousers,
        b: tones.shoes,
        ...chairTones,
      });
      people.set(key, sprite);
      return sprite;
    },
    chair: compileSprite(CHAIR, chairTones),
    desk: compileSprite(deskGrid(), furniture),
    screen: lazily((kind: ScreenKind) => compileSprite(SCREENS[kind], screenTones)),
    shelves: compileSprite(shelvesGrid(), {
      ...furniture,
      g: "#4F9E5E",
      b: "#4C7FD0",
      a: "#D9963B",
      r: "#C8504F",
    }),
    board: compileSprite(boardGrid(), { ...furniture, m: tones.metalLight, M: tones.metal }),
    rack: [compileSprite(rackGrid(false), furniture), compileSprite(rackGrid(true), furniture)],
    sofa: compileSprite(sofaGrid(), furniture),
    coffee: compileSprite(coffeeGrid(), furniture),
    plant: compileSprite(plantGrid(), { ...furniture, g: tones.plant, G: tones.plantDark }),
    rocket: compileSprite(rocketGrid(), { ...furniture, p: "#F1F1EE", s: "#D5D5D0", r: "#D8484D" }),
    pad: compileSprite(padGrid(), furniture),
    flame: compileSprite(flameGrid(), furniture),
    tray: (sheets, flag) => trays(`${sheets}${flag ? "f" : ""}`),
    cart: compileSprite(cartGrid(), cleaning),
    janitor: lazily((pose: Pose) => compileSprite(POSES[pose], janitorTones)),
    broom: compileSprite(broomGrid(), cleaning),
    server: compileSprite(serverGrid(), furniture),
    bubble: compileSprite(BUBBLE, { i: "#3A3F47", p: "#F8F6F0" }),
    icon: lazily((kind: IconKind) => compileSprite(ICONS[kind], iconTones)),
    plateMark: compileSprite(ICONS.plan, { i: tones.textMuted }),
  };
}

let day: Art | null = null;
let night: Art | null = null;

/** The pictures in the day's or the night's tones; each set is built on first use. */
export function artFor(dark: boolean): Art {
  if (dark) {
    night ??= buildArt(NIGHT);
    return night;
  }
  day ??= buildArt(DAY);
  return day;
}

export const PERSON = { width: PERSON_W, height: 16, seatedHeight: 12 } as const;
