// What the streamed 3D view tells the host, gathered into one call at a time: each call crosses
// the link to the host, so a second one waits for the first and takes everything said meanwhile.
import type { PointerStep, RenderInputMessage, RenderSize } from "../../shared/contracts.js";
import type { RenderFocus } from "../../shared/render.js";

/** The contract's limit on one call's steps. */
export const MAX_STEPS_PER_CALL = 64;
export const STREAM_GONE = "The host no longer has this 3D view";

export interface StreamOutboxDeps {
  send(message: RenderInputMessage): Promise<{ ok: boolean }>;
  /** The stream cannot be reached any more; called once. */
  onLost(reason: string): void;
}

export interface StreamOutbox {
  /** The host named the stream: what was said before goes out now. */
  ready(streamId: string): void;
  /** The seq of the last picture on screen. */
  shown(seq: number): void;
  steps(steps: readonly PointerStep[]): void;
  focus(target: RenderFocus): void;
  resize(size: RenderSize): void;
  /** Says the viewer is still there; nothing is sent while a call is on its way. */
  keepAlive(): void;
  stop(): void;
}

export function createStreamOutbox(deps: StreamOutboxDeps): StreamOutbox {
  let streamId: string | null = null;
  let stopped = false;
  let inFlight = false;
  let shown: number | undefined;
  let steps: PointerStep[] = [];
  let focus: RenderFocus | undefined;
  let resize: RenderSize | undefined;

  function lose(reason: string): void {
    if (stopped) return;
    stopped = true;
    deps.onLost(reason);
  }

  function flush(force = false): void {
    if (stopped || streamId === null || inFlight) return;
    const pending =
      shown !== undefined || steps.length > 0 || focus !== undefined || resize !== undefined;
    if (!pending && !force) return;
    const message: RenderInputMessage = { streamId };
    if (shown !== undefined) message.shown = shown;
    if (resize !== undefined) message.resize = resize;
    if (steps.length > 0) message.steps = steps.splice(0, MAX_STEPS_PER_CALL);
    if (focus !== undefined) message.focus = focus;
    shown = undefined;
    resize = undefined;
    focus = undefined;
    inFlight = true;
    void (async () => {
      let answer: { ok: boolean };
      try {
        answer = await deps.send(message);
      } catch (error) {
        inFlight = false;
        lose(error instanceof Error ? error.message : String(error));
        return;
      }
      inFlight = false;
      if (answer.ok) flush();
      else lose(STREAM_GONE);
    })();
  }

  return {
    ready(id) {
      streamId = id;
      flush();
    },
    shown(seq) {
      shown = seq;
      flush();
    },
    steps(next) {
      if (next.length === 0) return;
      steps.push(...next);
      flush();
    },
    focus(target) {
      focus = target;
      flush();
    },
    resize(size) {
      resize = size;
      flush();
    },
    keepAlive: () => flush(true),
    stop() {
      stopped = true;
    },
  };
}
