import { expect, test } from "vitest";
import { INITIAL_STREAM, streamReducer } from "./use-render-stream.js";

const picture = (seq: number, jpeg = "abc") =>
  ({ type: "picture", seq, jpeg, width: 585, height: 1050 }) as const;

test("ready names the stream", () => {
  expect(streamReducer(INITIAL_STREAM, { type: "ready", streamId: "s1" })).toEqual({
    ...INITIAL_STREAM,
    streamId: "s1",
  });
});

test("a picture replaces the last and becomes a data URI", () => {
  const first = streamReducer(INITIAL_STREAM, picture(1, "AAA"));
  const second = streamReducer(first, picture(2, "BBB"));

  expect(second.picture).toEqual({
    seq: 2,
    uri: "data:image/jpeg;base64,BBB",
    width: 585,
    height: 1050,
  });
});

test("a picture older than the one shown is ignored", () => {
  const shown = streamReducer(INITIAL_STREAM, picture(5));

  expect(streamReducer(shown, picture(4))).toBe(shown);
});

test("a problem is kept, and the last picture stays under it", () => {
  const shown = streamReducer(INITIAL_STREAM, picture(1));

  const ended = streamReducer(shown, { type: "problem", message: "The 3D view stopped: x" });

  expect(ended.problem).toBe("The 3D view stopped: x");
  expect(ended.picture?.seq).toBe(1);
});

test("a selection changes nothing here", () => {
  expect(streamReducer(INITIAL_STREAM, { type: "select", target: "agent", id: "a1" })).toBe(
    INITIAL_STREAM,
  );
});

test("a new stream on the same view, as after a reconnect, starts over: its first picture shows", () => {
  const old = streamReducer(INITIAL_STREAM, picture(40, "OLD"));

  const reopened = streamReducer(old, { type: "ready", streamId: "s2" });
  const fresh = streamReducer(reopened, picture(1, "NEW"));

  expect(reopened.picture).toBeNull();
  expect(fresh.picture?.uri).toBe("data:image/jpeg;base64,NEW");
});
