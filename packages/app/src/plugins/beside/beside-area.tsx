import { NavigationContext } from "expo-router/react-navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { View, useWindowDimensions } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import {
  FULL_SHEET_SNAP_POINTS,
  SheetBackground,
  SheetBottomInset,
  SheetDragArea,
  SheetHandle,
} from "@/components/adaptive-modal-sheet";
import { ResizeHandle } from "@/components/resize-handle";
import { useRetainedPanelActive } from "@/components/retained-panel";
import {
  IsolatedBottomSheetModal,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";
import { useSheetPaneBridgeAnywhere } from "@/screens/workspace/sheet-pane";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { clampBesideWidth } from "./beside-layout";
import { useBesideStore } from "./store";

type BesideKindName = ResolvedBesideTarget["kind"];
type BesideTargetOf<K extends BesideKindName> = Extract<ResolvedBesideTarget, { kind: K }>;
type ShowBeside = (target: ResolvedBesideTarget) => boolean;
type BesideArea = NonNullable<ReturnType<typeof useBesideStore.getState>["areas"][string]>;

/** What the side area shows for one kind of target. */
export interface BesideKind<K extends BesideKindName> {
  /** False makes `showBeside` answer false and show nothing. */
  available(target: BesideTargetOf<K>): boolean;
  Header: ComponentType<{ target: BesideTargetOf<K>; close(): void }>;
  /** Remounted for a new target, kept for the same one. */
  Body: ComponentType<{ target: BesideTargetOf<K>; surfaceKey: string; close(): void }>;
}

const kinds = new Map<BesideKindName, BesideKind<BesideKindName>>();

export function registerBesideKind<K extends BesideKindName>(kind: K, entry: BesideKind<K>): void {
  // Looked up by the target's own kind, so each entry only ever sees its own targets.
  kinds.set(kind, entry as unknown as BesideKind<BesideKindName>);
}

function kindOf(target: ResolvedBesideTarget): BesideKind<BesideKindName> {
  const kind = kinds.get(target.kind);
  invariant(kind, `No side area kind registered for ${target.kind}`);
  return kind;
}

const ShowBesideContext = createContext<ShowBeside | undefined>(undefined);

/** The `showBeside` of the side area around the caller, for its navigation; none outside one. */
export function useShowBeside(): ShowBeside | undefined {
  return useContext(ShowBesideContext);
}

const NO_UNSUBSCRIBE = () => undefined;

/** Whether the route around the caller is focused. True outside a navigator. */
function useRouteFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return NO_UNSUBSCRIBE;
      const offFocus = navigation.addListener("focus", onChange);
      const offBlur = navigation.addListener("blur", onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  return useSyncExternalStore(subscribe, () => navigation?.isFocused() ?? true);
}

interface BesideFrameProps {
  /** The surface's own key: a screen's route, or a panel's tab. One area per key. */
  surfaceKey: string;
  children: ReactNode;
}

/**
 * The side area around a plugin's content: a resizable panel on its right on wide layouts, a sheet
 * over it on compact ones. Its `showBeside` reaches the content through `useShowBeside`. Leaving
 * the surface closes the area: unmounting, a retained panel switched away from, or its route
 * covered by another. It is never restored.
 */
export function BesideFrame({ surfaceKey, children }: BesideFrameProps) {
  const compact = useIsCompactFormFactor();
  const area = useBesideStore((state) => state.areas[surfaceKey]);
  const panelActive = useRetainedPanelActive();
  const routeFocused = useRouteFocused();
  const shown = panelActive && routeFocused;

  // Read by `showBeside`, which stays one function for the surface's lifetime: a target asked for
  // while the surface is out of view, or after it is gone, would come back on the next visit.
  const accepting = useRef(shown);
  useEffect(() => {
    accepting.current = shown;
    if (!shown) useBesideStore.getState().close(surfaceKey);
  }, [shown, surfaceKey]);
  useEffect(
    () => () => {
      accepting.current = false;
      useBesideStore.getState().close(surfaceKey);
    },
    [surfaceKey],
  );

  const showBeside = useCallback<ShowBeside>(
    (target) => {
      // Plugins call this at runtime with whatever kind they name.
      const kind = kinds.get(target.kind);
      if (!accepting.current || !kind?.available(target)) return false;
      useBesideStore.getState().show(surfaceKey, target);
      return true;
    },
    [surfaceKey],
  );
  const close = useCallback(() => useBesideStore.getState().close(surfaceKey), [surfaceKey]);

  return (
    <ShowBesideContext.Provider value={showBeside}>
      <View style={styles.frame}>
        {/* One place in the tree on every layout, so the content never remounts. */}
        <View style={styles.content}>{children}</View>
        {compact ? <BesideSheet surfaceKey={surfaceKey} area={area} close={close} /> : null}
        {!compact && area ? (
          <BesidePanel surfaceKey={surfaceKey} area={area} close={close} />
        ) : null}
      </View>
    </ShowBesideContext.Provider>
  );
}

interface BesideContentProps {
  surfaceKey: string;
  area: BesideArea;
  close(): void;
}

const RESIZE_GROUP_ID = "beside";

function BesidePanel({ surfaceKey, area, close }: BesideContentProps) {
  const { width: windowWidth } = useWindowDimensions();
  const storedWidth = useBesideStore((state) => state.width);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = clampBesideWidth(dragWidth ?? storedWidth, windowWidth);
  // The handle drags a two-part split of [content, area]. Its sizes are shares of the window's
  // width, which only carries the drag: they convert straight back to the area's pixels.
  const sizes = useMemo(() => [1 - width / windowWidth, width / windowWidth], [width, windowWidth]);
  const previewResize = useCallback(
    (_groupId: string, next: number[]) => {
      setDragWidth(clampBesideWidth(next[1] * windowWidth, windowWidth));
    },
    [windowWidth],
  );
  const commitResize = useCallback(
    (_groupId: string, next: number[]) => {
      setDragWidth(null);
      useBesideStore.getState().setWidth(clampBesideWidth(next[1] * windowWidth, windowWidth));
    },
    [windowWidth],
  );
  const panelStyle = useMemo(() => [styles.panel, inlineUnistylesStyle({ width })], [width]);
  const { Header, Body } = kindOf(area.target);

  return (
    <>
      <ResizeHandle
        testID="beside-resize-handle"
        direction="horizontal"
        groupId={RESIZE_GROUP_ID}
        index={0}
        sizes={sizes}
        containerSize={windowWidth}
        onPreviewResizeSplit={previewResize}
        onResizeSplit={commitResize}
      />
      <View style={panelStyle} testID="beside-panel">
        <Header target={area.target} close={close} />
        <View style={styles.body}>
          <Body key={area.revision} target={area.target} surfaceKey={surfaceKey} close={close} />
        </View>
      </View>
    </>
  );
}

/**
 * The compact area: a sheet on the app-wide stack. Close, drag down, the backdrop and Android
 * Back all close the area; closing the area slides the sheet away.
 */
function BesideSheet({
  surfaceKey,
  area,
  close,
}: Omit<BesideContentProps, "area"> & { area: BesideArea | undefined }) {
  // The sheet keeps the last area while it slides away. Gorhom drops the content once dismissed.
  const [held, setHeld] = useState(area);
  if (area && area !== held) setHeld(area);
  // The plugin's own screen has no workspace; a plugin's workspace panel does.
  const contextBridge = useSheetPaneBridgeAnywhere();
  const { sheetRef, handleSheetChange, handleSheetDismiss } = useIsolatedBottomSheetVisibility({
    visible: area !== undefined,
    onClose: close,
  });

  return (
    <IsolatedBottomSheetModal
      ref={sheetRef}
      contextBridge={contextBridge}
      snapPoints={FULL_SHEET_SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose
      // The body scrolls on its own; the sheet drags from its handle and header.
      enableContentPanningGesture={false}
      backgroundComponent={SheetBackground}
      handleComponent={SheetHandle}
      backdropOpacity={0.45}
      onChange={handleSheetChange}
      onDismiss={handleSheetDismiss}
      accessible={false}
    >
      {held ? <BesideSheetPane surfaceKey={surfaceKey} area={held} close={close} /> : null}
    </IsolatedBottomSheetModal>
  );
}

function BesideSheetPane({ surfaceKey, area, close }: BesideContentProps) {
  const { Header, Body } = kindOf(area.target);
  return (
    <View style={styles.sheetPane}>
      {/* The body scrolls on its own, so the header is where the sheet drags from. */}
      <SheetDragArea>
        <Header target={area.target} close={close} />
      </SheetDragArea>
      <SheetBottomInset style={styles.body}>
        <Body key={area.revision} target={area.target} surfaceKey={surfaceKey} close={close} />
      </SheetBottomInset>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  panel: {
    flexShrink: 0,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  sheetPane: {
    flex: 1,
    minHeight: 0,
  },
}));
