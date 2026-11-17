import { NavigationContext } from "expo-router/react-navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import {
  FULL_SHEET_SNAP_POINTS,
  SheetBackground,
  SheetBottomInset,
  SheetDragArea,
  SheetHandle,
  SheetHeaderView,
  type SheetHeader,
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
import { SurfaceErrorBoundary } from "../surface-error-boundary";
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
  /** The surface's own key, a screen's route or a panel's tab: it names the area's tab. */
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
  // One area per mounted frame: a frame that remounts (a layout flip moves a panel to another tree)
  // or another copy of the same screen on the stack never inherits an area it did not open.
  const areaKey = `${surfaceKey}#${useId()}`;
  const area = useBesideStore((state) => state.areas[areaKey]);
  // The area shares the frame's own width with the content, which a sidebar or the panes of a
  // split can make narrower than the window. The window stands in until the frame is measured.
  const { width: windowWidth } = useWindowDimensions();
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const measureFrame = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    // A hidden retained panel lays out at zero; keep the last real width.
    if (width > 0) setFrameWidth(width);
  }, []);
  const panelActive = useRetainedPanelActive();
  const routeFocused = useRouteFocused();
  const shown = panelActive && routeFocused;

  // Read by `showBeside`, which stays one function for the surface's lifetime: a target asked for
  // while the surface is out of view, or after it is gone, would come back on the next visit.
  const accepting = useRef(shown);
  useEffect(() => {
    accepting.current = shown;
    if (!shown) useBesideStore.getState().close(areaKey);
  }, [shown, areaKey]);
  useEffect(
    () => () => {
      accepting.current = false;
      useBesideStore.getState().close(areaKey);
    },
    [areaKey],
  );

  const showBeside = useCallback<ShowBeside>(
    (target) => {
      // Plugins call this at runtime with whatever kind they name.
      const kind = kinds.get(target.kind);
      if (!accepting.current || !kind?.available(target)) return false;
      useBesideStore.getState().show(areaKey, target);
      return true;
    },
    [areaKey],
  );
  const close = useCallback(() => useBesideStore.getState().close(areaKey), [areaKey]);

  return (
    <ShowBesideContext.Provider value={showBeside}>
      <View style={styles.frame} onLayout={measureFrame} testID="beside-frame">
        {/* One place in the tree on every layout, so the content never remounts. */}
        <View style={styles.content}>{children}</View>
        {compact ? <BesideSheet surfaceKey={surfaceKey} area={area} close={close} /> : null}
        {!compact && area ? (
          <BesidePanel
            surfaceKey={surfaceKey}
            area={area}
            close={close}
            frameWidth={frameWidth ?? windowWidth}
          />
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

function BesidePanel({
  surfaceKey,
  area,
  close,
  frameWidth,
}: BesideContentProps & { frameWidth: number }) {
  const storedWidth = useBesideStore((state) => state.width);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = clampBesideWidth(dragWidth ?? storedWidth, frameWidth);
  // The handle drags a two-part split of [content, area]: shares of the frame's width, converted
  // straight back to the area's pixels.
  const sizes = useMemo(() => [1 - width / frameWidth, width / frameWidth], [width, frameWidth]);
  const previewResize = useCallback(
    (_groupId: string, next: number[]) => {
      setDragWidth(clampBesideWidth(next[1] * frameWidth, frameWidth));
    },
    [frameWidth],
  );
  const commitResize = useCallback(
    (_groupId: string, next: number[]) => {
      setDragWidth(null);
      useBesideStore.getState().setWidth(clampBesideWidth(next[1] * frameWidth, frameWidth));
    },
    [frameWidth],
  );
  const panelStyle = useMemo(() => [styles.panel, inlineUnistylesStyle({ width })], [width]);

  return (
    <>
      <ResizeHandle
        testID="beside-resize-handle"
        direction="horizontal"
        groupId={RESIZE_GROUP_ID}
        index={0}
        sizes={sizes}
        containerSize={frameWidth}
        onPreviewResizeSplit={previewResize}
        onResizeSplit={commitResize}
      />
      <View style={panelStyle} testID="beside-panel">
        <BesideAreaContent surfaceKey={surfaceKey} area={area} close={close} inSheet={false} />
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
      {held ? (
        <View style={styles.sheetPane}>
          <BesideAreaContent surfaceKey={surfaceKey} area={held} close={close} inSheet />
        </View>
      ) : null}
    </IsolatedBottomSheetModal>
  );
}

interface AreaSlotProps {
  inSheet: boolean;
  children: ReactNode;
}

/** In the sheet the header drags it: the body scrolls on its own, so content panning is off. */
function HeaderSlot({ inSheet, children }: AreaSlotProps) {
  return inSheet ? <SheetDragArea>{children}</SheetDragArea> : children;
}

/** In the sheet the body owns the screen's bottom inset. */
function BodySlot({ inSheet, children }: AreaSlotProps) {
  return inSheet ? (
    <SheetBottomInset style={styles.body}>{children}</SheetBottomInset>
  ) : (
    <View style={styles.body}>{children}</View>
  );
}

/**
 * The target's header over its body, inside one boundary of their own: a target that throws shows
 * its error in the area under a header that still closes it, and the plugin's content keeps
 * running. A new target clears it.
 */
function BesideAreaContent({
  surfaceKey,
  area,
  close,
  inSheet,
}: BesideContentProps & { inSheet: boolean }) {
  const kind = kindOf(area.target);
  const { Header, Body } = kind;
  const renderError = useCallback(
    (error: string) => <BesideFailure error={error} close={close} inSheet={inSheet} />,
    [close, inSheet],
  );
  return (
    // The plugin surfaces' boundary, keyed to the kind and the area's revision instead of a plugin.
    <SurfaceErrorBoundary
      installation={kind}
      Surface={Body}
      resetKey={area.revision}
      renderError={renderError}
    >
      <HeaderSlot inSheet={inSheet}>
        <Header target={area.target} close={close} />
      </HeaderSlot>
      <BodySlot inSheet={inSheet}>
        <Body key={area.revision} target={area.target} surfaceKey={surfaceKey} close={close} />
      </BodySlot>
    </SurfaceErrorBoundary>
  );
}

const FAILURE_HEADER: SheetHeader = { title: "Could not show this" };

function BesideFailure({
  error,
  close,
  inSheet,
}: {
  error: string;
  close(): void;
  inSheet: boolean;
}) {
  return (
    <>
      <HeaderSlot inSheet={inSheet}>
        <SheetHeaderView
          header={FAILURE_HEADER}
          onClose={close}
          testID="beside-header"
          closeTestID="beside-header-close"
        />
      </HeaderSlot>
      <BodySlot inSheet={inSheet}>
        <Text style={styles.failure}>{error}</Text>
      </BodySlot>
    </>
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
  // The look of a failed plugin surface (surface-error-boundary.tsx).
  failure: {
    color: theme.colors.statusDanger,
    padding: theme.spacing[4],
  },
}));
