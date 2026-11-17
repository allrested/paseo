import { expect, test } from "vitest";
import { createChatEngine, REACTIONS, type EngineMessage } from "./src/shared/chat-engine.js";
import { t } from "./src/i18n/index.js";
import chat from "./src/i18n/locales/en/chat.js";

test("the vendored engine makes its first line and speaks upstream's English", () => {
  const added: EngineMessage[] = [];
  createChatEngine({
    tr: t,
    now: () => 0,
    members: () => [],
    staffName: () => null,
    store: { load: () => null, save: () => undefined },
    emit: (op, payload) => {
      if (op === "add" && payload && !Array.isArray(payload)) added.push(payload);
    },
  });
  expect(REACTIONS).toHaveLength(6);
  expect(chat.stickers).toHaveLength(8);
  expect(t("chat.stickers", null, "list")).toEqual(chat.stickers);
  expect(t("chat.boss")).toBe("Boss");
});
