import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writePrivateFileAtomic } from "../../../private-files.js";
import { ProfileCookieSchema, type ProfileCookie } from "./profile-cookie.js";

const VaultFileSchema = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  cookies: z.array(ProfileCookieSchema),
});

// A profile id becomes a file name, so it may hold nothing that leaves the folder.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Each profile's cookies, one owner-only file per profile. Chromium keeps a browser context in
 * memory alone, so this file is what a profile's logins come back from after it restarts.
 */
export class CdpCookieVault {
  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The stored cookies; none when the profile has no file yet. Rejects when the file is unreadable. */
  async read(profileId: string): Promise<ProfileCookie[]> {
    let raw: string;
    try {
      raw = await readFile(this.fileOf(profileId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    // A parse error would quote the file, which holds cookie values.
    const parsed = VaultFileSchema.safeParse(parseJson(raw));
    if (!parsed.success) throw new Error("The stored cookies of the profile are not readable.");
    return parsed.data.cookies;
  }

  async write(profileId: string, cookies: readonly ProfileCookie[]): Promise<void> {
    const body = { version: 1, savedAt: this.now(), cookies };
    await writePrivateFileAtomic(this.fileOf(profileId), JSON.stringify(body));
  }

  async remove(profileId: string): Promise<void> {
    await rm(this.fileOf(profileId), { force: true });
  }

  private fileOf(profileId: string): string {
    if (!SAFE_ID.test(profileId)) throw new Error("The profile id is not a file name.");
    return path.join(this.directory, `${profileId}.json`);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
