import type { RenderEvent } from "../../shared/contracts.js";

const JPEG_URI = "data:image/jpeg;base64,";

export interface StreamPicture {
  seq: number;
  /** A data URI an Image can show. */
  uri: string;
  /** Device pixels. */
  width: number;
  height: number;
}

export interface StreamState {
  /** Null until the host named the stream. */
  streamId: string | null;
  picture: StreamPicture | null;
  /** Why the host ended the stream, once it has. */
  problem: string | null;
}

export const INITIAL_STREAM: StreamState = { streamId: null, picture: null, problem: null };

/** What the view keeps of the host's events. Selections pass through to the surface, not here. */
export function streamReducer(state: StreamState, event: RenderEvent): StreamState {
  // A new stream starts over, also on the same view: after a reconnect the host opens a new page
  // whose pictures count from 1 again, and the old picture is not what that page shows.
  if (event.type === "ready") return { streamId: event.streamId, picture: null, problem: null };
  if (event.type === "problem") return { ...state, problem: event.message };
  if (event.type !== "picture") return state;
  if (state.picture !== null && event.seq <= state.picture.seq) return state;
  const { seq, jpeg, width, height } = event;
  return { ...state, picture: { seq, uri: `${JPEG_URI}${jpeg}`, width, height } };
}
