import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { notesWriteRpc, worldRpc } from "../../shared/contracts.js";
import type { OfficeModel } from "../../shared/model.js";
import { failureText } from "../action-button.js";
import { boardRoom, isDarkTheme } from "./adapter.js";
import { PLAN } from "./use-world-feed.js";
import type { WorldBrand, WorldStartOptions } from "./world-api.js";
import { sharedWorldLoader } from "./world-loader.js";

/** What the scene's callbacks and its start read: always the last render's. */
export interface WorldLatest {
  model: OfficeModel;
  theme: PluginTheme;
  focusRoomId: string | null;
  selectedAgentId: string | null;
  onSelectAgent(agentId: string | null): void;
  onSelectBoard(roomId: string): void;
  onOpenMachine(): void;
  onOpenResources: (() => void) | undefined;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenLibrary(): void;
  onOpenNotes(): void;
  onOpenIncidents(): void;
  onBell(): void | Promise<void>;
  onProblem(message: string): void;
}

/**
 * The scene's start, read from the last render. What a callback opens is Paseo's (a card, a sheet):
 * the keyboard goes with it through `extras.focus`. The bell opens nothing of Paseo's, and a card
 * closed from the scene opens nothing, so neither takes the keyboard.
 */
export function worldStartOptions(
  latest: { readonly current: WorldLatest },
  extras: { focus(): void; brand: WorldBrand; photo?: false },
): WorldStartOptions {
  const { focus } = extras;
  const { colors } = latest.current.theme;
  return {
    plan: PLAN,
    dark: isDarkTheme(colors),
    colors,
    brand: extras.brand,
    ...(extras.photo === undefined ? {} : { photo: extras.photo }),
    onSelect: (agentId) => {
      if (agentId !== null) focus();
      latest.current.onSelectAgent(agentId);
    },
    onBoard: (project) => {
      focus();
      const now = latest.current;
      const roomId = boardRoom(now.model, {
        project,
        focusRoomId: now.focusRoomId,
        selectedAgentId: now.selectedAgentId,
      });
      if (roomId !== null) now.onSelectBoard(roomId);
    },
    onMachine: () => {
      focus();
      latest.current.onOpenMachine();
    },
    onLibrary: () => {
      focus();
      latest.current.onOpenLibrary();
    },
    // Given only where Paseo can show Resources: otherwise the scene keeps the wall screen on
    // onMachine, the Host card.
    ...(latest.current.onOpenResources === undefined
      ? {}
      : {
          onResources: () => {
            focus();
            latest.current.onOpenResources?.();
          },
        }),
    // Given only where the office can open a session (the agent card's "Open session"): otherwise
    // a person under E is chosen, as a click does. The keyboard goes with the session.
    ...(latest.current.onOpenSession === undefined
      ? {}
      : {
          onOpen: (agentId: string) => {
            focus();
            latest.current.onOpenSession?.(agentId);
          },
        }),
    onBell: () => void latest.current.onBell(),
    onNotes: () => {
      focus();
      latest.current.onOpenNotes();
    },
    onIncidents: () => {
      focus();
      latest.current.onOpenIncidents();
    },
    onProblem: (message) => latest.current.onProblem(message),
  };
}

const subscribe = (listener: () => void) => sharedWorldLoader.subscribe(listener);
const read = () => sharedWorldLoader.state();

/**
 * The office's script, loaded once per page. Nothing loads while `enabled` is false (a tab that was
 * never shown has no size). After a failed load the loader keeps its failure until asked again, so
 * the answer is read after this load, not from the render's state.
 */
export function useWorldScript(
  enabled: boolean,
  onProblem: (message: string) => void,
): string | null {
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchWorld = useRpc(worldRpc);
  const fetchScript = useCallback(() => fetchWorld({}), [fetchWorld]);
  const problem = useRef(onProblem);
  useEffect(() => {
    problem.current = onProblem;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    async function load(): Promise<void> {
      await sharedWorldLoader.load(fetchScript);
      const state = sharedWorldLoader.state();
      if (mounted && state.status === "failed") problem.current(state.error);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [fetchScript, enabled]);
  return loadState.status === "ready" ? loadState.script : null;
}

/**
 * A click on the bell has the stand-up notes written. Whether a writer started is not waited for:
 * the Stand-up card's line says what the writer does.
 */
export function useStandupBell(): () => Promise<void> {
  const writeNotes = useRpc(notesWriteRpc);
  const toast = useToast();
  return useCallback(async () => {
    try {
      await writeNotes({});
    } catch (error) {
      toast.error(failureText("Write the stand-up notes", error));
    }
  }, [writeNotes, toast]);
}
