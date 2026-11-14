// What the sheet view keeps of the host's events: the sheet it draws and the tiles that go with it.
// A new backdrop arrives as tiles before the sheet that names it is complete, so the view keeps
// drawing the old pictures with the old sheet until every tile of the new version is there.
import type { SheetEvent } from "../../shared/contracts.js";
import type { Sheet, SheetTile } from "../../shared/sheet.js";

export interface ShownSheet {
  sheet: Sheet;
  /** By index, complete. */
  tiles: SheetTile[];
}

export interface SheetState {
  /** Null until the host named the sheet. */
  sheetId: string | null;
  shown: ShownSheet | null;
  /** Why the host ended the view, once it has. */
  problem: string | null;
  /** Tiles of versions newer than the shown one, by version and index, as they arrive. */
  collected: Record<number, Array<SheetTile | undefined>>;
  /** The newest sheet, while it waits for its tiles. */
  waiting: Sheet | null;
}

export const INITIAL_SHEET: SheetState = {
  sheetId: null,
  shown: null,
  problem: null,
  collected: {},
  waiting: null,
};

function completeTiles(collected: SheetState["collected"], sheet: Sheet): SheetTile[] | undefined {
  const tiles = collected[sheet.version];
  if (tiles === undefined) return undefined;
  const complete: SheetTile[] = [];
  for (let index = 0; index < sheet.tiles; index += 1) {
    const tile = tiles[index];
    if (tile === undefined) return undefined;
    complete.push(tile);
  }
  return complete;
}

function withoutOlder(collected: SheetState["collected"], version: number) {
  return Object.fromEntries(
    Object.entries(collected).filter(([key]) => Number(key) > version),
  ) as SheetState["collected"];
}

/** Shows the waiting sheet if everything it needs is here. */
function settle(state: SheetState): SheetState {
  const { waiting, shown } = state;
  if (waiting === null) return state;
  if (shown !== null && waiting.version < shown.sheet.version) return { ...state, waiting: null };
  if (shown !== null && waiting.version === shown.sheet.version) {
    return { ...state, shown: { sheet: waiting, tiles: shown.tiles }, waiting: null };
  }
  const tiles = completeTiles(state.collected, waiting);
  if (tiles === undefined) return state;
  return {
    ...state,
    shown: { sheet: waiting, tiles },
    waiting: null,
    collected: withoutOlder(state.collected, waiting.version),
  };
}

export function sheetReducer(state: SheetState, event: SheetEvent): SheetState {
  // A new sheet id starts over: after a reconnect the host has a new page, with its own tiles.
  if (event.type === "ready") return { ...INITIAL_SHEET, sheetId: event.sheetId };
  if (event.type === "problem") return { ...state, problem: event.message };
  if (event.type === "sheet") return settle({ ...state, waiting: event.sheet });
  const { tile } = event;
  if (state.shown !== null && tile.version <= state.shown.sheet.version) return state;
  const tiles = [...(state.collected[tile.version] ?? [])];
  tiles[tile.index] = tile;
  return settle({ ...state, collected: { ...state.collected, [tile.version]: tiles } });
}
