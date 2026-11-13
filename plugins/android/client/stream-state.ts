import type { AndroidStreamEvent } from "../shared/contracts.js";

const PNG_URI = "data:image/png;base64,";

export interface StreamPicture {
  seq: number;
  /** A data URI an Image can show. */
  uri: string;
}

export interface StreamState {
  /** Null until the host named the stream. */
  streamId: string | null;
  /** The device's screen in pixels, from `ready`. */
  device: { width: number; height: number } | null;
  picture: StreamPicture | null;
  /** Why the host ended the stream, once it has. */
  problem: string | null;
}

export const INITIAL_STREAM: StreamState = {
  streamId: null,
  device: null,
  picture: null,
  problem: null,
};

export function streamReducer(state: StreamState, event: AndroidStreamEvent): StreamState {
  // A new stream starts over, also on the same view: after a reconnect the host opens a new
  // stream whose pictures count from 1 again, and the old picture is not what it shows.
  if (event.type === "ready") {
    const { streamId, width, height } = event;
    return { streamId, device: { width, height }, picture: null, problem: null };
  }
  if (event.type === "problem") return { ...state, problem: event.message };
  if (state.picture !== null && event.seq <= state.picture.seq) return state;
  return { ...state, picture: { seq: event.seq, uri: `${PNG_URI}${event.png}` } };
}
