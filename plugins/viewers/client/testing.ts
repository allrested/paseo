// A file panel's props for a mounted test: a file kept in memory, and the host's theme.
import type { PluginFile, PluginFileEvent, PluginFilePanelProps } from "@getpaseo/plugin/client";

export interface FakeFile extends PluginFile {
  /** How often the panel read the file. */
  reads: number;
  /** Another program writes the file. */
  change(content: string): void;
  /** Another program deletes the file. */
  remove(): void;
}

export interface FakeFileOptions {
  /** The file's size, when it is not its content's length. */
  size?: number;
}

/** A file whose reads answer `content`, or reject with it. */
export function fakeFile(
  name: string,
  content: string | Error,
  options: FakeFileOptions = {},
): FakeFile {
  const listeners = new Set<(event: PluginFileEvent) => void>();
  let current = content;
  const read = async () => {
    file.reads += 1;
    if (current instanceof Error) throw current;
    return current;
  };
  const notify = (event: PluginFileEvent) => {
    for (const listener of listeners) listener(event);
  };
  const file: FakeFile = {
    path: `/work/${name}`,
    name,
    extension: name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "",
    size: options.size ?? (typeof content === "string" ? content.length : 0),
    modifiedAt: "2026-11-15T09:00:00.000Z",
    mimeType: "application/octet-stream",
    reads: 0,
    readText: read,
    readBytes: async () => new TextEncoder().encode(await read()),
    url: async () => `blob:${await read()}`,
    writeText: async () => {},
    writeBytes: async () => {},
    watch(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    change(next) {
      current = next;
      notify({ type: "changed" });
    },
    remove: () => notify({ type: "deleted" }),
  };
  return file;
}

/** A file whose reads never answer. */
export function pendingFile(name: string): FakeFile {
  const never = () => new Promise<never>(() => {});
  return Object.assign(fakeFile(name, ""), { readText: never, readBytes: never, url: never });
}

/** The props a file tab gives its panel, at a pointer's sizes unless `compact`. */
export function panelProps(file: PluginFile, compact = false): PluginFilePanelProps {
  return {
    theme: { colors: new Proxy({}, { get: () => "#808080" }) },
    layout: { compact, platform: "web" },
    host: { id: "host", label: "Host" },
    workspaceId: "w1",
    params: { path: file.path },
    revision: 0,
    file,
    tab: { setModified() {}, state: undefined, setState() {} },
  } as unknown as PluginFilePanelProps;
}
