/**
 * @vitest-environment jsdom
 */
// The Ports line under an agent or a group, mounted: one chip per port, and a tap that copies the
// port's address on the host. The clipboard and the toast are the host's, so the test holds them.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Port } from "../shared/rpc.js";
import { PortsLine } from "./ports-line.js";
import type { ScreenStyles } from "./styles.js";

const copied: string[] = [];
const shown: string[] = [];
const errors: string[] = [];
let clipboardFails = false;

vi.mock("@getpaseo/plugin/client/ui", () => {
  const toast = {
    show: (message: string) => void shown.push(message),
    error: (message: string) => void errors.push(message),
  };
  return {
    useToast: () => toast,
    copyText: async (text: string) => {
      if (clipboardFails) throw new Error("no clipboard");
      copied.push(text);
    },
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const STYLES = new Proxy({}, { get: () => ({}) }) as ScreenStyles;
const PORTS: Port[] = [
  { port: 3000, reach: "all" },
  { port: 9229, reach: "local" },
];

let container: HTMLElement;
let root: Root;

async function mount(ports: readonly Port[]): Promise<void> {
  await act(async () => root.render(<PortsLine ports={ports} who="Fix login" styles={STYLES} />));
}

const chips = () => [...container.querySelectorAll<HTMLElement>('[role="button"]')];

async function press(chip: HTMLElement | undefined): Promise<void> {
  if (!chip) throw new Error("No chip");
  await act(async () => chip.click());
  await act(async () => void (await new Promise((done) => setTimeout(done, 0))));
}

beforeEach(() => {
  copied.length = 0;
  shown.length = 0;
  errors.length = 0;
  clipboardFails = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("shows nothing for an agent that listens on no port", async () => {
  await mount([]);
  expect(container.textContent).toBe("");
});

test("lists each port with how far it can be reached, under a name for the list", async () => {
  await mount(PORTS);
  expect(container.querySelector('[aria-label="Ports of Fix login"]')).not.toBeNull();
  expect(chips().map((chip) => chip.textContent)).toEqual(["3000all interfaces", "9229local only"]);
  expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
    "Copy http://localhost:3000, port 3000, all interfaces",
    "Copy http://localhost:9229, port 9229, local only",
  ]);
});

test("a tap copies the port's address on the host and says so", async () => {
  await mount(PORTS);
  await press(chips()[1]);
  expect(copied).toEqual(["http://localhost:9229"]);
  expect(shown).toEqual(["Copied http://localhost:9229"]);
  expect(errors).toEqual([]);
});

test("a clipboard that refuses is said, not swallowed", async () => {
  clipboardFails = true;
  await mount(PORTS);
  await press(chips()[0]);
  expect(shown).toEqual([]);
  expect(errors).toEqual(["Could not copy http://localhost:3000"]);
});
