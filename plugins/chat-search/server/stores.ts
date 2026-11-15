// The places chats are kept on this host, one store per provider. A store knows where its
// provider's transcripts are and how to read one; the search is the same for all of them.
import type { Provider } from "../shared/contracts.js";
import type { GrepOptions } from "./grep.js";
import { kiroRoot, kiroStore } from "./kiro.js";
import { listTranscripts, transcriptRoots, type Transcript } from "./sources.js";
import { readTranscript, type TranscriptRead } from "./transcript.js";

export interface ChatStore {
  provider: Provider;
  /** Every chat's transcript, newest first. */
  list(): Promise<Transcript[]>;
  /** The messages of one transcript that hold the words, or null when none does. */
  read(
    file: string,
    words: string,
    maxSnippets: number,
    grep?: GrepOptions,
  ): Promise<TranscriptRead | null>;
}

/** Claude Code's chats under these projects folders (transcriptRoots). */
export function claudeStore(roots: readonly string[]): ChatStore {
  return { provider: "claude", list: () => listTranscripts(roots), read: readTranscript };
}

/** Every store of this host. A provider that is not installed has a store with no chats. */
export function hostStores(env: NodeJS.ProcessEnv, home: string): ChatStore[] {
  return [claudeStore(transcriptRoots(env, home)), kiroStore(kiroRoot(home))];
}
