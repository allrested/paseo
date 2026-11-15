// One pane's element pick: the toolbar button starts it, the daemon makes the page a picker, and
// the picked element waits for the person's note.
import type { CdpBrowserElementSelection } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

export type ElementPickState =
  | { status: "idle" }
  | { status: "picking" }
  | { status: "annotating"; selection: CdpBrowserElementSelection };

export interface ElementPickPorts {
  /** Resolves with the element, or null for a pick that ended without one; rejects with the daemon's error code. */
  pick(): Promise<CdpBrowserElementSelection | null>;
  /** Tells the daemon to end the pick. May throw when the socket is down. */
  cancel(): void;
  onState(state: ElementPickState): void;
  /** The page is still loading, or the pick could not start. */
  onFailure(reason: "loading" | "failed"): void;
}

export interface ElementPick {
  start(): void;
  /** Ends a running pick, and drops a picked element that waits for its note. */
  stop(): void;
}

const IDLE: ElementPickState = { status: "idle" };
const PICKING: ElementPickState = { status: "picking" };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createElementPick(ports: ElementPickPorts): ElementPick {
  // Counts picks, so the answer of one that was stopped or replaced changes nothing.
  let run = 0;
  let status: ElementPickState["status"] = "idle";
  const set = (state: ElementPickState) => {
    status = state.status;
    ports.onState(state);
  };
  return {
    start() {
      run += 1;
      const id = run;
      set(PICKING);
      ports.pick().then(
        (selection) => {
          if (run === id) set(selection ? { status: "annotating", selection } : IDLE);
          return undefined;
        },
        (error: unknown) => {
          if (run !== id) return;
          set(IDLE);
          const code = errorText(error);
          // Nobody picked in time: the button goes off and there is nothing to report.
          if (code === "browser_timeout") return;
          ports.onFailure(code === "browser_page_loading" ? "loading" : "failed");
        },
      );
    },
    stop() {
      const picking = status === "picking";
      run += 1;
      if (status !== "idle") set(IDLE);
      if (!picking) return;
      try {
        ports.cancel();
      } catch {
        // The socket dropped. The daemon ends the pick with the session, or after its 30 s.
      }
    },
  };
}
