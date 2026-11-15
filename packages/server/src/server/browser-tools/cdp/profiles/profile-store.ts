import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../../atomic-file.js";
import { hasControlCharacter } from "./characters.js";

export const PROFILE_LIMIT = 12;
export const PROFILE_NAME_MAX = 40;
/** The built-in profile's name: the Chromium's own profile, which every tab used before profiles. */
export const SHARED_PROFILE_NAME = "Shared";

const CdpProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  /** The browser context Chromium last had for this profile. It is gone after Chromium restarts. */
  contextId: z.string().optional(),
});
const CdpProfileFileSchema = z.object({
  version: z.literal(1),
  profiles: z.array(CdpProfileSchema),
  /** Workspace id to profile id. A workspace that is not listed uses the Shared profile. */
  workspaces: z.record(z.string(), z.string()),
});

export type CdpProfile = z.infer<typeof CdpProfileSchema>;

export type CdpProfileErrorCode =
  | "browser_profile_not_found"
  | "browser_profile_name_invalid"
  | "browser_profile_name_taken"
  | "browser_profile_limit";

export class CdpProfileError extends Error {
  constructor(public readonly code: CdpProfileErrorCode) {
    super(code);
    this.name = "CdpProfileError";
  }
}

/** A name as it is stored: trimmed, inner runs of spaces as one. Throws when it cannot be a name. */
export function profileName(input: string): string {
  const name = input.trim().replace(/\s+/g, " ");
  // Counted in code points, so a name of 40 emoji is 40 long.
  const length = [...name].length;
  if (length === 0 || length > PROFILE_NAME_MAX || hasControlCharacter(name)) {
    throw new CdpProfileError("browser_profile_name_invalid");
  }
  return name;
}

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** The named browser profiles and which one each workspace opens its tabs in. */
export class CdpProfileStore {
  private profiles: CdpProfile[] = [];
  private readonly workspaces = new Map<string, string>();
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  async load(): Promise<void> {
    this.profiles = [];
    this.workspaces.clear();
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const parsed = CdpProfileFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      this.profiles = parsed.profiles;
      for (const [workspaceId, profileId] of Object.entries(parsed.workspaces)) {
        if (this.get(profileId)) this.workspaces.set(workspaceId, profileId);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.report(error);
    }
  }

  /** In the order they were made. */
  list(): CdpProfile[] {
    return [...this.profiles];
  }

  get(profileId: string): CdpProfile | null {
    return this.profiles.find((profile) => profile.id === profileId) ?? null;
  }

  create(input: { id: string; name: string; now: number }): CdpProfile {
    const name = profileName(input.name);
    if (
      sameName(name, SHARED_PROFILE_NAME) ||
      this.profiles.some((profile) => sameName(profile.name, name))
    ) {
      throw new CdpProfileError("browser_profile_name_taken");
    }
    if (this.profiles.length >= PROFILE_LIMIT) throw new CdpProfileError("browser_profile_limit");
    const profile: CdpProfile = { id: input.id, name, createdAt: input.now };
    this.profiles.push(profile);
    this.schedule();
    return profile;
  }

  /** The workspaces that used the profile go back to Shared. */
  remove(profileId: string): CdpProfile | null {
    const profile = this.get(profileId);
    if (!profile) return null;
    this.profiles = this.profiles.filter((each) => each.id !== profileId);
    for (const [workspaceId, used] of this.workspaces) {
      if (used === profileId) this.workspaces.delete(workspaceId);
    }
    this.schedule();
    return profile;
  }

  /** Null is the Shared profile. */
  assign(workspaceId: string, profileId: string | null): void {
    if (profileId === null) {
      if (this.workspaces.delete(workspaceId)) this.schedule();
      return;
    }
    if (!this.get(profileId)) throw new CdpProfileError("browser_profile_not_found");
    if (this.workspaces.get(workspaceId) === profileId) return;
    this.workspaces.set(workspaceId, profileId);
    this.schedule();
  }

  /** The profile the workspace opens its tabs in; null is Shared. */
  profileOf(workspaceId: string): CdpProfile | null {
    const profileId = this.workspaces.get(workspaceId);
    return profileId === undefined ? null : this.get(profileId);
  }

  setContext(profileId: string, contextId: string | null): void {
    const profile = this.get(profileId);
    if (!profile || (profile.contextId ?? null) === contextId) return;
    const { contextId: _previous, ...rest } = profile;
    const next: CdpProfile = contextId === null ? rest : { ...rest, contextId };
    this.profiles = this.profiles.map((each) => (each.id === profileId ? next : each));
    this.schedule();
  }

  flush(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  /** The error sink is caller code; a throwing sink must not become an unhandled rejection. */
  private report(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Nothing left to tell: the sink itself failed.
    }
  }

  /** One writer at a time; a change made during a write is picked up by the next loop turn. */
  private schedule(): void {
    this.dirty = true;
    if (this.writing) return;
    this.writing = this.drain();
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      try {
        await writeJsonFileAtomic(this.filePath, {
          version: 1,
          profiles: this.profiles,
          workspaces: Object.fromEntries(this.workspaces),
        });
      } catch (error) {
        this.report(error);
      }
    }
    // Same synchronous turn as the dirty check: no gap where a change goes unwritten.
    this.writing = null;
  }
}
