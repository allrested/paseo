import { LOBBY } from "../../shared/contracts.js";
import {
  EMPTY_LAYOUT_MEMORY,
  ROOM_WIDTH,
  columnsFitting,
  columnsFor,
  layoutOffice,
  type Bounds,
} from "../layout.js";
import type { OfficeModel } from "../model.js";
import { FIRST_MARGINS, groundSpan, wholeScale, type Viewport } from "./camera.js";

/**
 * Another column count replaces the one in use only when it shows the office this many times
 * larger. A browser bar that hides, or one workspace more, then does not deal the rooms anew.
 */
const WORTH_A_NEW_GRID = 1.1;
/** Two scales nearer than this are one: the same span, summed in another order. */
const SAME_SCALE = 1e-9;

/** An office of `rooms` rooms with nobody in it: the lobby and workspaces of one row of desks. */
function emptyOffice(rooms: number): OfficeModel {
  return {
    rooms: Array.from({ length: rooms }, (_, index) => ({
      id: index === 0 ? LOBBY : `room-${index}`,
      name: "",
      subtitle: null,
      lobby: index === 0,
      rows: [],
      posts: [],
    })),
    attention: [],
    agents: new Map(),
    roomOfAgent: new Map(),
  };
}

/** CSS pixels per world unit at which an empty office of `rooms` rooms shows whole in `columns`. */
function scaleIn(columns: number, rooms: number, viewport: Viewport): number {
  const { layout } = layoutOffice(emptyOffice(rooms), EMPTY_LAYOUT_MEMORY, columns);
  const floors = layout.rooms.map(
    (room): Bounds => ({
      minX: room.center.x - ROOM_WIDTH / 2,
      maxX: room.center.x + ROOM_WIDTH / 2,
      minZ: room.center.z - room.depth / 2,
      maxZ: room.center.z + room.depth / 2,
    }),
  );
  return wholeScale(groundSpan(floors), viewport, FIRST_MARGINS);
}

/**
 * How many columns of rooms an office of `rooms` rooms gets on this view: from the count for the
 * view's shape (`columnsFor`) up to what its width has room for (`columnsFitting`), the one that
 * shows the whole office largest, and the fewer of two that show it equally large. On a tablet
 * held upright a few rooms stack in one column, and fifteen stand in two.
 *
 * Only the number of rooms counts, never who is in them: a room that grows a row of desks, or
 * an agent that joins or leaves, does not change the grid. `held` is the count in use. It stays
 * while the view has room for it and no other count is `WORTH_A_NEW_GRID`.
 */
export function gridColumns(viewport: Viewport, rooms: number, held?: number): number {
  const least = columnsFor(viewport);
  const most = Math.max(least, columnsFitting(viewport));
  if (rooms < 1 || !(viewport.width > 0) || !(viewport.height > 0)) return least;
  let best = least;
  let bestScale = scaleIn(least, rooms, viewport);
  for (let columns = least + 1; columns <= most; columns += 1) {
    const scale = scaleIn(columns, rooms, viewport);
    if (scale > bestScale * (1 + SAME_SCALE)) {
      best = columns;
      bestScale = scale;
    }
  }
  if (held === undefined || held < least || held > most || held === best) return best;
  return bestScale > scaleIn(held, rooms, viewport) * WORTH_A_NEW_GRID ? best : held;
}
