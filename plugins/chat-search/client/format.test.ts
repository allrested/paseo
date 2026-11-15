import { describe, expect, it } from "vitest";
import { ago, countText, folderName, hitMeta, overview } from "./format.js";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");

describe("chat search text", () => {
  it("says how long ago a chat changed", () => {
    expect(ago("2026-11-14T11:59:40.000Z", NOW)).toBe("just now");
    expect(ago("2026-11-14T11:15:00.000Z", NOW)).toBe("45 min ago");
    expect(ago("2026-11-14T07:00:00.000Z", NOW)).toBe("5 h ago");
    expect(ago("2026-11-11T12:00:00.000Z", NOW)).toBe("3 d ago");
    expect(ago("2026-07-01T12:00:00.000Z", NOW)).toBe("on 2026-07-01");
    // A clock that disagrees with the host's never shows a negative age.
    expect(ago("2026-11-14T12:05:00.000Z", NOW)).toBe("just now");
  });

  it("names a folder by its last part", () => {
    expect(folderName("/work/shop")).toBe("shop");
    expect(folderName("/work/shop/")).toBe("shop");
    expect(folderName("/")).toBe("/");
    expect(folderName(null)).toBeNull();
  });

  it("counts the messages, and says when the count stopped at the limit", () => {
    expect(countText(1)).toBe("1 message");
    expect(countText(4)).toBe("4 messages");
    expect(countText(10)).toBe("10 or more messages");
  });

  it("puts a chat's provider, folder, age and count on one line", () => {
    const hit = {
      provider: "claude" as const,
      folder: "/work/shop",
      changedAt: "2026-11-14T07:00:00.000Z",
      matches: 2,
    };
    expect(hitMeta(hit, NOW)).toBe("Claude · shop · 5 h ago · 2 messages");
    expect(hitMeta({ ...hit, provider: "kiro", folder: null }, NOW)).toBe(
      "Kiro · 5 h ago · 2 messages",
    );
  });

  it("sums up a result", () => {
    expect(overview({ chats: [], others: [], more: false }, "token")).toBe('No chat says "token"');
    expect(overview({ chats: [{}], others: [], more: false }, "token")).toBe("1 chat");
    expect(overview({ chats: [{}, {}], others: [{}], more: false }, "token")).toBe("3 chats");
    expect(overview({ chats: [{}], others: [{}], more: true }, "token")).toBe(
      "The 2 newest chats that match. Add a word to narrow the search",
    );
  });
});
