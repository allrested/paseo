import type { SetStateAction } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { ChatMessage } from "../shared/contracts.js";
import type { OfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

/** What a panel of the column asks of the surface it is drawn in. */
export interface OfficeLink {
  /** Opens the agent's card, as a press on a List row does. */
  select(agentId: string): void;
  /** Shows the agent's session. */
  openSession(agentId: string): void;
}

/** What the surface hands each panel of its column. */
export interface ColumnPanelProps {
  /** The surface's one subscription to the office. */
  office: OfficeState;
  styles: OfficeStyles;
  theme: PluginTheme;
  layout: PluginSurfaceProps["layout"];
  link: OfficeLink;
}

/** What is typed in the chat's box and what it replies to: the surface's, so a tab switch keeps it. */
export interface ChatDraft {
  text: string;
  /** Takes an updater as well: a send that returns keeps what was typed while it was away. */
  setText(next: SetStateAction<string>): void;
  replyTo: ChatMessage | null;
  setReplyTo(next: ChatMessage | null): void;
}
