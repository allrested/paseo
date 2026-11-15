import { expect, test } from "vitest";
import { NO_WEBGL, scriptedPages, type PagePort, type RenderViewport } from "./page-host.js";

const VIEWPORT: RenderViewport = { width: 64, height: 64, deviceScaleFactor: 1 };

interface FakePort extends PagePort {
  evaluated: string[];
  closed: boolean;
}

function fakePort(webgl: boolean): FakePort {
  const port: FakePort = {
    evaluated: [],
    closed: false,
    evaluate: async <T>(expression: string) => {
      port.evaluated.push(expression);
      return (expression.includes('getContext("webgl2")') ? webgl : undefined) as T;
    },
    send: async () => {},
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
  const open = scriptedPages({
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
    pageEntry: "/office/render/sheet-page.ts",
  });
  return { open, ports, opened, bundles: () => bundles };
}

test("loads three.js, then the page script", async () => {
  const { open, ports, opened } = setup();

  await open(VIEWPORT);

  expect(opened).toEqual([VIEWPORT]);
  const [webgl, three, script] = ports[0]!.evaluated;
  expect(webgl).toContain('getContext("webgl2")');
  expect(three).toContain("export const REVISION = '170';");
  expect(three).toContain("__officeThree");
  expect(script).toBe("/* script of /office/render/sheet-page.ts */");
  expect(ports[0]!.evaluated).toHaveLength(3);
});

test("a browser without WebGL is refused in those words, and its page is closed", async () => {
  const { open, ports } = setup({ webgl: false });

  await expect(open(VIEWPORT)).rejects.toThrow(NO_WEBGL);

  expect(ports[0]!.closed).toBe(true);
  expect(ports[0]!.evaluated).toHaveLength(1);
});

test("builds the page script once for every viewer, and again after a failed build", async () => {
  const { open, bundles } = setup({ bundleFails: 1 });

  await expect(open(VIEWPORT)).rejects.toThrow("build failed");
  await open(VIEWPORT);
  await open(VIEWPORT);

  expect(bundles()).toBe(2);
});
