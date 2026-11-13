import { expect, test } from "vitest";
import { LIGHT_THEME_COLORS } from "../../client/scene/fake-theme.js";
import { NO_WEBGL, createRenderPageHost, type PagePort, type RenderViewport } from "./page-host.js";

const VIEWPORT: RenderViewport = { width: 390, height: 700, deviceScaleFactor: 1.5 };
const INPUT = { viewport: VIEWPORT, colors: LIGHT_THEME_COLORS, coarsePointer: true };

interface FakePort extends PagePort {
  evaluated: string[];
  mouse: Array<Record<string, unknown>>;
  closed: boolean;
}

function fakePort(webgl: boolean): FakePort {
  const port: FakePort = {
    evaluated: [],
    mouse: [],
    closed: false,
    evaluate: async <T>(expression: string) => {
      port.evaluated.push(expression);
      return (expression.includes('getContext("webgl2")') ? webgl : undefined) as T;
    },
    send: async (method, params) => {
      if (method === "Input.dispatchMouseEvent") port.mouse.push(params ?? {});
    },
    setViewport: async () => {},
    close: async () => {
      port.closed = true;
    },
    onClosed: () => () => {},
  };
  return port;
}

function setup(options: { webgl?: boolean; bundleFails?: number } = {}) {
  const ports: FakePort[] = [];
  const opened: RenderViewport[] = [];
  let bundles = 0;
  let failures = options.bundleFails ?? 0;
  const host = createRenderPageHost({
    pages: {
      open: async (viewport) => {
        opened.push(viewport);
        const port = fakePort(options.webgl ?? true);
        ports.push(port);
        return port;
      },
    },
    bundle: async (entry) => {
      bundles += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error("build failed");
      }
      return `/* script of ${entry} */`;
    },
    readThree: async () => new TextEncoder().encode("export const REVISION = '170';"),
    pageEntry: "/office/render/page.ts",
  });
  return { host, ports, opened, bundles: () => bundles };
}

const mouseOf = (port: FakePort) =>
  port.mouse.map((event) => `${String(event.type)}@${String(event.x)},${String(event.y)}`);

test("loads three.js, then the page script, then starts the scene in the viewer's theme", async () => {
  const { host, ports, opened } = setup();

  await host.open(INPUT);

  expect(opened).toEqual([VIEWPORT]);
  const [webgl, three, script, start] = ports[0]!.evaluated;
  expect(webgl).toContain('getContext("webgl2")');
  expect(three).toContain("export const REVISION = '170';");
  expect(three).toContain("__officeThree");
  expect(script).toBe("/* script of /office/render/page.ts */");
  expect(start).toBe(
    `globalThis["__officeRender"].start(${JSON.stringify({ colors: LIGHT_THEME_COLORS, coarsePointer: true })})`,
  );
});

test("a browser without WebGL is refused in those words, and its page is closed", async () => {
  const { host, ports } = setup({ webgl: false });

  await expect(host.open(INPUT)).rejects.toThrow(NO_WEBGL);

  expect(ports[0]!.closed).toBe(true);
  expect(ports[0]!.evaluated).toHaveLength(1);
});

test("builds the page script once for every viewer, and again after a failed build", async () => {
  const { host, bundles } = setup({ bundleFails: 1 });

  await expect(host.open(INPUT)).rejects.toThrow("build failed");
  await host.open(INPUT);
  await host.open(INPUT);

  expect(bundles()).toBe(2);
});

test("a tap goes in as a mouse press and release, with the button held between", async () => {
  const { host, ports } = setup();
  const page = await host.open(INPUT);

  await page.pointer([
    { type: "down", x: 10, y: 20 },
    { type: "up", x: 10, y: 20 },
  ]);

  expect(ports[0]!.mouse).toEqual([
    { type: "mousePressed", x: 10, y: 20, button: "left", buttons: 1, clickCount: 1 },
    { type: "mouseReleased", x: 10, y: 20, button: "left", buttons: 0, clickCount: 1 },
  ]);
});

test("a drag keeps the button held on its moves", async () => {
  const { host, ports } = setup();
  const page = await host.open(INPUT);

  await page.pointer([
    { type: "down", x: 10, y: 20 },
    { type: "move", x: 10, y: 60 },
    { type: "up", x: 10, y: 60 },
  ]);

  expect(ports[0]!.mouse[1]).toEqual({
    type: "mouseMoved",
    x: 10,
    y: 60,
    button: "left",
    buttons: 1,
    clickCount: 0,
  });
  expect(mouseOf(ports[0]!)).toEqual([
    "mousePressed@10,20",
    "mouseMoved@10,60",
    "mouseReleased@10,60",
  ]);
});

test("a cancelled press moves past the tap slop and back, so the scene picks nothing", async () => {
  const { host, ports } = setup();
  const page = await host.open(INPUT);

  await page.pointer([
    { type: "down", x: 10, y: 20 },
    { type: "cancel", x: 0, y: 0 },
  ]);

  expect(mouseOf(ports[0]!)).toEqual([
    "mousePressed@10,20",
    "mouseMoved@20,20",
    "mouseMoved@10,20",
    "mouseReleased@10,20",
  ]);
});

test("a cancelled drag is released where it started, without the extra moves", async () => {
  const { host, ports } = setup();
  const page = await host.open(INPUT);

  await page.pointer([
    { type: "down", x: 10, y: 20 },
    { type: "move", x: 10, y: 80 },
    { type: "cancel", x: 0, y: 0 },
  ]);

  expect(mouseOf(ports[0]!)).toEqual([
    "mousePressed@10,20",
    "mouseMoved@10,80",
    "mouseReleased@10,20",
  ]);
});

test("a release or a cancel with no press sends nothing", async () => {
  const { host, ports } = setup();
  const page = await host.open(INPUT);

  await page.pointer([
    { type: "up", x: 1, y: 1 },
    { type: "cancel", x: 1, y: 1 },
  ]);

  expect(ports[0]!.mouse).toEqual([]);
});
