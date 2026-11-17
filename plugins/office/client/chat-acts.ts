/**
 * What the chat asks the open scenes to do. The surface and each open panel have their own
 * subscription and each brings the same act, so an act is passed on once by its id.
 */

type ChatActListener = (what: "meeting") => void;

const KEPT_IDS = 50;
const listeners = new Set<ChatActListener>();
const heard: string[] = [];

export function onChatAct(listener: ChatActListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitChatAct(change: { what: "meeting"; id: string }): void {
  if (heard.includes(change.id)) return;
  heard.push(change.id);
  if (heard.length > KEPT_IDS) heard.splice(0, heard.length - KEPT_IDS);
  for (const listener of listeners) listener(change.what);
}
