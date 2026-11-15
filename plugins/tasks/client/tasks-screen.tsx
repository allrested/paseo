import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import type { PluginOpenScreenInput, PluginScreenProps } from "@getpaseo/plugin/client";
import { CONNECTIONS_SCREEN, TASKS_SCREEN, TASK_PARAM } from "../shared/contracts.js";
import { hasTouchScreen, useMeasuredWidth } from "./device.js";
import { TaskDetailPane } from "./task-detail.js";
import { TaskList } from "./task-list.js";
import { useTasksStyles } from "./tasks-styles.js";

export interface TasksScreenPorts {
  openScreen(input: PluginOpenScreenInput): void;
  openSettings(id: string): void;
}

// The settings shell's split (docs/design.md section 9): the list is 320 wide and gives way first,
// and the page beside it is never under 400. A screen too narrow for both shows one at a time.
const LIST_WIDTH = 320;
const LIST_MIN = 240;
const PAGE_MIN = 400;

/** The list's width beside the page, or null when the screen has no room for both. */
export function splitListWidth(width: number): number | null {
  if (width < LIST_MIN + PAGE_MIN) return null;
  return Math.min(LIST_WIDTH, width - PAGE_MIN);
}

/**
 * The tasks screen, in the settings shell's shape: the list fills the screen and a task opens
 * over it, or, where both fit, the list stays beside the task. The open task is a screen param,
 * so it has an address and Back returns to the list.
 */
export function createTasksScreen(ports: TasksScreenPorts) {
  return function TasksScreen({ theme, layout, params, navigation }: PluginScreenProps) {
    // Asked once for the screen's life, like the app: a mouse plugged into a tablet does not
    // shrink its controls.
    const touchScreen = useMemo(() => hasTouchScreen(layout.platform), [layout.platform]);
    const styles = useTasksStyles(theme, layout.compact, touchScreen);
    // The window being wide says little: a docked sidebar takes 320 of a tablet's 820.
    const { width, onLayout } = useMeasuredWidth();
    const listWidth = layout.compact || width === null ? null : splitListWidth(width);
    const listPane = useMemo(
      () => [styles.listPane, { width: listWidth ?? 0 }],
      [styles, listWidth],
    );
    const selected = params[TASK_PARAM] ?? null;
    const open = useCallback(
      (id: string) => ports.openScreen({ screenId: TASKS_SCREEN, params: { [TASK_PARAM]: id } }),
      [],
    );
    const close = useCallback(() => ports.openScreen({ screenId: TASKS_SCREEN }), []);
    const connect = useCallback(() => ports.openSettings(CONNECTIONS_SCREEN), []);
    const openWorkspace = useMemo(
      () =>
        navigation === undefined
          ? undefined
          : (workspaceId: string) => navigation.openWorkspace({ workspaceId }),
      [navigation],
    );
    const list = <TaskList styles={styles} selected={selected} onOpen={open} onConnect={connect} />;
    // Keyed by the task: a comment half written for one is not left in the box of the next.
    const page = (onBack?: () => void) =>
      selected === null ? null : (
        <TaskDetailPane
          key={selected}
          id={selected}
          styles={styles}
          onBack={onBack}
          onOpenWorkspace={openWorkspace}
        />
      );
    // A phone's header has the way back; a wide window's has none, so the page brings its own.
    if (layout.compact) return <View style={styles.screen}>{page() ?? list}</View>;
    if (width === null) return <View style={styles.screen} onLayout={onLayout} />;
    if (listWidth === null) {
      return (
        <View style={styles.screen} onLayout={onLayout}>
          {page(close) ?? list}
        </View>
      );
    }
    return (
      <View style={styles.split} onLayout={onLayout}>
        <View style={listPane}>{list}</View>
        <View style={styles.detailPane}>
          {page() ?? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Pick a task to read it</Text>
            </View>
          )}
        </View>
      </View>
    );
  };
}
