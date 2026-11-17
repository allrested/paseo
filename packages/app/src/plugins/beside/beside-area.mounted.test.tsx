/**
 * @vitest-environment jsdom
 */
// The side area around a plugin's content, mounted with a test kind: the wide panel, the compact
// sheet, Close, an unavailable target, closing when the surface is left, and one area per frame.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { Text } from "react-native";
import { NavigationContext } from "expo-router/react-navigation";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { i18n } from "@/i18n/i18next";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";
import { BesideFrame, registerBesideKind, useShowBeside } from "./beside-area";
import { BesideHeader } from "./beside-header";
import { useBesideStore } from "./store";

// The package's CJS entry loads React Native's Flow sources, which the unit project cannot parse.
// The frame and the sheet bridge only read its two contexts.
vi.mock("expo-router/react-navigation", async () => {
  const { createContext } = await import("react");
  return {
    NavigationContext: createContext(undefined),
    NavigationRouteContext: createContext(undefined),
  };
});

// A 1280px desktop window with a mouse, read once when React Native Web and the pointer
// capabilities load: jsdom has no layout and answers no media query.
vi.hoisted(() => {
  Object.defineProperty(document.documentElement, "clientWidth", { value: 1280 });
  const queries = window.matchMedia;
  window.matchMedia = (query: string) =>
    query === "(hover: hover) and (pointer: fine)"
      ? Object.assign(queries(query), { matches: true })
      : queries(query);
});

// React Native Web reports `onLayout` through one ResizeObserver, which jsdom lacks. This one lets a
// test lay a view out at a width of its choosing.
const layoutObserver = vi.hoisted(() => {
  let report: ((entries: { target: Element }[]) => void) | null = null;
  window.ResizeObserver = class {
    constructor(callback: (entries: { target: Element }[]) => void) {
      report = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return {
    /** Lays the element out `width` wide; React Native Web measures it on the next tick. */
    async layOut(element: HTMLElement, width: number) {
      Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
      report?.([{ target: element }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
});

const layout = vi.hoisted(() => ({ compact: false }));

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => layout.compact,
}));

/**
 * The presented sheet's drag-down, as Gorhom reports it: the index drops and the sheet dismisses.
 * `presents` counts every sheet's `present`.
 */
const sheet = vi.hoisted(() => ({ dragDown: null as null | (() => void), presents: 0 }));

// Gorhom's modal, reduced to what the frame relies on: it shows its content only while presented,
// and reports a dismissal through `onChange(-1)` and `onDismiss`, whoever started it.
vi.mock("@gorhom/bottom-sheet", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gorhom/bottom-sheet")>();
  const { createElement, forwardRef, useImperativeHandle, useRef, useState } =
    await import("react");
  const BottomSheetModal = forwardRef(function FakeBottomSheetModal(
    props: { children?: ReactNode; onChange?(index: number): void; onDismiss?(): void },
    ref,
  ) {
    const [presented, setPresented] = useState(false);
    const latest = useRef(props);
    latest.current = props;
    useImperativeHandle(ref, () => {
      const dismiss = () => {
        setPresented(false);
        latest.current.onChange?.(-1);
        latest.current.onDismiss?.();
      };
      sheet.dragDown = dismiss;
      return {
        present: () => {
          sheet.presents += 1;
          setPresented(true);
          latest.current.onChange?.(0);
        },
        dismiss,
        close: dismiss,
      };
    }, []);
    return presented
      ? createElement("div", { "data-testid": "beside-sheet" }, props.children)
      : null;
  });
  const noop = () => undefined;
  return {
    ...original,
    BottomSheetModal,
    useBottomSheetGestureHandlers: () => ({
      handlePanGestureHandler: {
        handleOnStart: noop,
        handleOnChange: noop,
        handleOnEnd: noop,
        handleOnFinalize: noop,
      },
    }),
  };
});

type AgentTarget = Extract<ResolvedBesideTarget, { kind: "agent" }>;

const OPEN_IN_WORKSPACE = { label: "Open in workspace", onPress: vi.fn() };
let bodyMounts: string[] = [];

/** Agents with these ids make the test kind's header or body throw while rendering. */
const BROKEN_HEADER = { kind: "agent", agentId: "broken-header", serverId: "host" } as const;
const BROKEN_BODY = { kind: "agent", agentId: "broken-body", serverId: "host" } as const;

function TestHeader({ target, close }: { target: AgentTarget; close(): void }) {
  if (target.agentId === BROKEN_HEADER.agentId) throw new Error("The header exploded");
  return (
    <BesideHeader
      icon={null}
      title={`Agent ${target.agentId}`}
      subtitle="shop-api"
      action={OPEN_IN_WORKSPACE}
      onClose={close}
    />
  );
}

function TestBody({ target }: { target: AgentTarget; surfaceKey: string; close(): void }) {
  useEffect(() => {
    bodyMounts.push(target.agentId);
  }, [target.agentId]);
  if (target.agentId === BROKEN_BODY.agentId) throw new Error("The body exploded");
  return <Text testID="beside-test-body">{target.agentId}</Text>;
}

registerBesideKind("agent", {
  available: (target) => target.agentId !== "unknown",
  Header: TestHeader,
  Body: TestBody,
});

let showBeside: ((target: ResolvedBesideTarget) => boolean) | undefined;

function PluginContent() {
  showBeside = useShowBeside();
  return <Text testID="plugin-content">The office</Text>;
}

function frame(surfaceKey = "host:office:office") {
  return (
    <BesideFrame surfaceKey={surfaceKey}>
      <PluginContent />
    </BesideFrame>
  );
}

function show(target: ResolvedBesideTarget): boolean {
  let shown = false;
  act(() => {
    shown = showBeside!(target);
  });
  return shown;
}

/** jsdom has no PointerEvent; React reads the pointer's id and position off any event. */
function pointerEvent(type: string, clientX: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

/** A mouse drag on the area's separator, from one window x to another. */
function drag(separator: HTMLElement, fromX: number, toX: number) {
  act(() => {
    separator.dispatchEvent(pointerEvent("pointerdown", fromX));
  });
  act(() => {
    window.dispatchEvent(pointerEvent("pointermove", toX));
  });
  act(() => {
    window.dispatchEvent(pointerEvent("pointerup", toX));
  });
}

/** A route the test can cover with another, as a pushed screen does. */
function fakeRoute() {
  const blurListeners = new Set<() => void>();
  let focused = true;
  const navigation = {
    isFocused: () => focused,
    addListener(type: string, listener: () => void) {
      if (type !== "blur") return () => undefined;
      blurListeners.add(listener);
      return () => blurListeners.delete(listener);
    },
  };
  return {
    navigation: navigation as never,
    cover() {
      focused = false;
      for (const listener of blurListeners) listener();
    },
  };
}

const AGENT_ONE = { kind: "agent", agentId: "one", serverId: "host" } as const;
const AGENT_TWO = { kind: "agent", agentId: "two", serverId: "host" } as const;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  layout.compact = false;
  sheet.dragDown = null;
  sheet.presents = 0;
  bodyMounts = [];
  showBeside = undefined;
  OPEN_IN_WORKSPACE.onPress.mockClear();
  useBesideStore.setState(useBesideStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});

describe("BesideFrame on wide layouts", () => {
  it("shows only the plugin's content while nothing is beside it", () => {
    render(frame());

    expect(screen.getByTestId("plugin-content")).toBeTruthy();
    expect(screen.queryByTestId("beside-panel")).toBeNull();
    expect(screen.queryByText(/^Agent /)).toBeNull();
  });

  it("shows the target's header in a panel to the right of the content, and Close removes it", () => {
    render(frame());

    expect(show(AGENT_ONE)).toBe(true);

    const title = screen.getByText("Agent one");
    const content = screen.getByTestId("plugin-content");
    const panel = screen.getByTestId("beside-panel");
    expect(panel.contains(title)).toBe(true);
    expect(content.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((panel.parentElement as HTMLElement).style.flexDirection).toBe("row");
    expect(panel.style.width).toBe("320px");
    expect(screen.getByText("shop-api")).toBeTruthy();
    act(() => fireEvent.click(screen.getByLabelText("Open in workspace")));
    expect(OPEN_IN_WORKSPACE.onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("beside-test-body").textContent).toBe("one");

    act(() => fireEvent.click(screen.getByLabelText("Close")));

    expect(screen.queryByTestId("beside-panel")).toBeNull();
    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.getByTestId("plugin-content")).toBeTruthy();
  });

  it("keeps a dragged width in memory, never so wide that the content drops below its minimum", () => {
    render(frame());
    show(AGENT_ONE);
    const separator = screen
      .getByTestId("beside-resize-handle")
      .querySelector<HTMLElement>('[role="separator"]')!;

    drag(separator, 1000, 900);
    expect(screen.getByTestId("beside-panel").style.width).toBe("420px");
    expect(useBesideStore.getState().width).toBe(420);

    drag(separator, 900, 0);
    expect(screen.getByTestId("beside-panel").style.width).toBe(`${1280 - 360}px`);
    expect(useBesideStore.getState().width).toBe(1280 - 360);
  });

  it("fits the frame it lays out, so the content keeps its minimum width beside a sidebar", async () => {
    render(frame());
    show(AGENT_ONE);
    const separator = screen
      .getByTestId("beside-resize-handle")
      .querySelector<HTMLElement>('[role="separator"]')!;
    // Until the frame is measured, the window's width stands in for it.
    drag(separator, 1000, 700);
    expect(screen.getByTestId("beside-panel").style.width).toBe("620px");

    // A pinned sidebar or a split pane leaves the frame 800 of the window's 1280.
    await act(() => layoutObserver.layOut(screen.getByTestId("beside-frame"), 800));

    expect(screen.getByTestId("beside-panel").style.width).toBe(`${800 - 360}px`);
    expect(useBesideStore.getState().width).toBe(620);

    await act(() => layoutObserver.layOut(screen.getByTestId("beside-frame"), 1200));
    expect(screen.getByTestId("beside-panel").style.width).toBe("620px");

    drag(separator, 700, 0);
    expect(useBesideStore.getState().width).toBe(1200 - 360);
  });

  it("keeps the body for the same target and remounts it for a new one", () => {
    render(frame());

    show(AGENT_ONE);
    show({ ...AGENT_ONE });
    expect(bodyMounts).toEqual(["one"]);

    show(AGENT_TWO);
    expect(bodyMounts).toEqual(["one", "two"]);
    expect(screen.getByText("Agent two")).toBeTruthy();
    expect(screen.queryByText("Agent one")).toBeNull();
  });
});

describe("BesideFrame on compact layouts", () => {
  beforeEach(() => {
    layout.compact = true;
  });

  it("opens the target in a sheet over the content, and Close dismisses it", () => {
    render(frame());
    expect(screen.queryByTestId("beside-sheet")).toBeNull();

    expect(show(AGENT_ONE)).toBe(true);

    const sheetElement = screen.getByTestId("beside-sheet");
    expect(sheetElement.contains(screen.getByText("Agent one"))).toBe(true);
    expect(screen.queryByTestId("beside-panel")).toBeNull();
    expect(screen.getByTestId("plugin-content")).toBeTruthy();

    act(() => fireEvent.click(screen.getByLabelText("Close")));

    expect(screen.queryByTestId("beside-sheet")).toBeNull();
    expect(useBesideStore.getState().areas).toEqual({});
  });

  it("closes the area when the sheet is dragged down", () => {
    render(frame());
    show(AGENT_ONE);

    act(() => sheet.dragDown!());

    expect(screen.queryByTestId("beside-sheet")).toBeNull();
    expect(useBesideStore.getState().areas).toEqual({});
  });
});

describe.each([
  ["wide", false, "beside-panel"],
  ["compact", true, "beside-sheet"],
] as const)(
  "BesideFrame when the target fails to render, %s",
  (_layoutName, compact, areaTestId) => {
    beforeEach(() => {
      layout.compact = compact;
      // The boundary reports what it caught; React reports it too.
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ["body", BROKEN_BODY, "The body exploded"],
      ["header", BROKEN_HEADER, "The header exploded"],
    ] as const)(
      "shows the error of a failing %s in the area and keeps the content",
      (_part, target, message) => {
        render(frame());

        expect(show(target)).toBe(true);

        const area = screen.getByTestId(areaTestId);
        expect(area.contains(screen.getByText("Could not show this"))).toBe(true);
        expect(area.contains(screen.getByText(message))).toBe(true);
        expect(screen.getByTestId("plugin-content").textContent).toBe("The office");

        show(AGENT_ONE);

        expect(screen.queryByText(message)).toBeNull();
        expect(screen.getByText("Agent one")).toBeTruthy();
        expect(screen.getByTestId("beside-test-body").textContent).toBe("one");
      },
    );

    it("closes from the failure's own header", () => {
      render(frame());
      show(BROKEN_HEADER);

      act(() => fireEvent.click(screen.getByLabelText("Close")));

      expect(useBesideStore.getState().areas).toEqual({});
      expect(screen.queryByTestId(areaTestId)).toBeNull();
      expect(screen.getByTestId("plugin-content")).toBeTruthy();
    });
  },
);

describe("BesideFrame targets and leaving", () => {
  it("answers false and shows nothing for an unavailable target or an unregistered kind", () => {
    render(frame());

    expect(show({ kind: "agent", agentId: "unknown", serverId: "host" })).toBe(false);
    expect(
      show({
        kind: "screen",
        pluginId: "resource-manager",
        screenId: "resources",
        serverId: "host",
      }),
    ).toBe(false);

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("beside-panel")).toBeNull();
  });

  it("clears its area when it unmounts, and refuses targets afterwards", () => {
    const view = render(frame("host:office:office"));
    show(AGENT_ONE);
    expect(screen.getByTestId("beside-panel")).toBeTruthy();

    view.unmount();

    expect(useBesideStore.getState().areas).toEqual({});
    expect(showBeside!(AGENT_TWO)).toBe(false);
    expect(useBesideStore.getState().areas).toEqual({});
  });

  it("closes when its retained panel is switched away from", () => {
    const panel = (active: boolean) => (
      <RetainedPanelActivity active={active}>{frame("host:workspace:tab")}</RetainedPanelActivity>
    );
    const view = render(panel(true));
    show(AGENT_ONE);
    expect(screen.getByTestId("beside-panel")).toBeTruthy();

    view.rerender(panel(false));

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("beside-panel")).toBeNull();

    view.rerender(panel(true));
    expect(screen.queryByTestId("beside-panel")).toBeNull();
  });

  it("closes when its route is covered by another", () => {
    const route = fakeRoute();
    render(
      <NavigationContext.Provider value={route.navigation}>{frame()}</NavigationContext.Provider>,
    );
    show(AGENT_ONE);

    act(() => route.cover());

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("beside-panel")).toBeNull();
  });
});

describe("BesideFrame owns its area, not its surface key", () => {
  it("starts empty when it remounts under the same key, as a panel does at the compact breakpoint", () => {
    // The workspace moves a panel to another tree when the window crosses the breakpoint: a new
    // frame renders before the old one's cleanup closes the old area.
    const view = render(
      <BesideFrame key="wide" surfaceKey="host:workspace:tab">
        <PluginContent />
      </BesideFrame>,
    );
    show(AGENT_ONE);
    expect(screen.getByTestId("beside-panel")).toBeTruthy();

    layout.compact = true;
    view.rerender(
      <BesideFrame key="compact" surfaceKey="host:workspace:tab">
        <PluginContent />
      </BesideFrame>,
    );

    // The new frame's sheet never sees the old area, so it is never presented and dismissed in
    // one frame, which leaves Gorhom's sheet stuck dismissing.
    expect(sheet.presents).toBe(0);
    expect(screen.queryByTestId("beside-sheet")).toBeNull();
    expect(useBesideStore.getState().areas).toEqual({});
    expect(bodyMounts).toEqual(["one"]);

    expect(show(AGENT_TWO)).toBe(true);
    expect(sheet.presents).toBe(1);
    expect(within(screen.getByTestId("beside-sheet")).getByText("Agent two")).toBeTruthy();
  });

  it("keeps a separate area for each of two frames with one key, as stacked copies of a screen", () => {
    const shows: Record<string, (target: ResolvedBesideTarget) => boolean> = {};
    function NamedContent({ name }: { name: string }) {
      shows[name] = useShowBeside()!;
      return <Text>{name}</Text>;
    }
    render(
      <>
        <BesideFrame surfaceKey="host:office:office">
          <NamedContent name="hidden" />
        </BesideFrame>
        <BesideFrame surfaceKey="host:office:office">
          <NamedContent name="top" />
        </BesideFrame>
      </>,
    );
    const [hiddenFrame, topFrame] = screen.getAllByTestId("beside-frame");

    act(() => {
      shows.top!(AGENT_ONE);
    });
    expect(within(topFrame!).getByText("Agent one")).toBeTruthy();
    expect(within(hiddenFrame!).queryByTestId("beside-panel")).toBeNull();

    act(() => {
      shows.hidden!(AGENT_TWO);
    });
    expect(within(hiddenFrame!).getByText("Agent two")).toBeTruthy();
    expect(within(topFrame!).getByText("Agent one")).toBeTruthy();
    expect(within(topFrame!).queryByText("Agent two")).toBeNull();

    act(() => fireEvent.click(within(topFrame!).getByLabelText("Close")));

    expect(within(topFrame!).queryByTestId("beside-panel")).toBeNull();
    expect(within(hiddenFrame!).getByText("Agent two")).toBeTruthy();
  });
});
