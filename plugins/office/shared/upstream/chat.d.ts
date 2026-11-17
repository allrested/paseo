// PASEO: types for chat.js, which is upstream's and stays as it is.
// A line, several ways to say it (an array), a { one, other } pair, or a group of these by name.

export type ChatWords = string | readonly ChatWords[] | { readonly [key: string]: ChatWords };

interface ChatArea {
  readonly [key: string]: ChatWords;
  readonly stickers: string[];
}

declare const chat: ChatArea;
export default chat;
