import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  MAX_QUERY,
  MIN_QUERY,
  searchRpc,
  type ChatHit,
  type SearchResult,
  type Snippet,
} from "../shared/contracts.js";
import { hitMeta, overview } from "./format.js";
import { useSearchStyles, type SearchStyles } from "./styles.js";

// Long enough that a word is typed whole before it is searched; Enter does not wait.
const PAUSE_MS = 400;
const HINT = `Type at least ${MIN_QUERY} characters. This searches what you and the agents wrote in every Claude chat on this host, loaded or not.`;
const OTHERS_INFO =
  "Claude sessions on this host that are no agent here, such as ones run in a terminal. They cannot be opened from this list.";
const ROLES: Record<Snippet["role"], string> = { user: "You", assistant: "Agent" };

type Search =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; words: string; result: SearchResult }
  | { status: "error"; message: string };

const IDLE: Search = { status: "idle" };
const LOADING: Search = { status: "loading" };

/** The result for the words, and nothing of an older search that answers late. */
function useChatSearch(words: string): Search {
  const search = useRpc(searchRpc);
  const [state, setState] = useState<Search>(IDLE);
  useEffect(() => {
    if (words.length < MIN_QUERY) {
      setState(IDLE);
      return undefined;
    }
    let current = true;
    setState(LOADING);
    search({ query: words }).then(
      (result) => current && setState({ status: "done", words, result }),
      (error: unknown) =>
        current &&
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      current = false;
    };
  }, [search, words]);
  return state;
}

function SnippetLine({ snippet, styles }: { snippet: Snippet; styles: SearchStyles }) {
  return (
    <Text style={styles.snippet}>
      <Text style={styles.snippetRole}>{ROLES[snippet.role]}: </Text>
      {snippet.before}
      <Text style={styles.match} testID="chat-search-match">
        {snippet.match}
      </Text>
      {snippet.after}
    </Text>
  );
}

interface HitProps {
  hit: ChatHit;
  now: number;
  styles: SearchStyles;
  /** Absent for a session that is no agent here, and on a host without navigation. */
  onOpen?: (agentId: string) => void;
}

// The arrow is what tells a chat that opens from one that is only listed.
function HitBody({ hit, now, styles, opens }: HitProps & { opens: boolean }) {
  return (
    <>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {hit.title}
        </Text>
        {opens ? <Icon name="ChevronRight" size={16} color={styles.iconColor} /> : null}
      </View>
      <Text style={styles.cardMeta}>{hitMeta(hit, now)}</Text>
      {hit.snippets.map((snippet, index) => (
        // A chat's snippets never reorder: they are the first matches, in the chat's order.
        // eslint-disable-next-line react/no-array-index-key
        <SnippetLine key={index} snippet={snippet} styles={styles} />
      ))}
    </>
  );
}

function HitCard({ hit, now, styles, onOpen }: HitProps) {
  const { agentId } = hit;
  const open = useCallback(() => {
    if (agentId !== null) onOpen?.(agentId);
  }, [agentId, onOpen]);
  if (agentId === null || onOpen === undefined) {
    return (
      <View style={styles.card}>
        <HitBody hit={hit} now={now} styles={styles} opens={false} />
        {agentId === null ? (
          <Text style={styles.cardMeta} selectable>
            Session {hit.sessionId}
            {hit.folder === null ? "" : ` in ${hit.folder}`}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Open chat ${hit.title}`}
      style={styles.card}
    >
      <HitBody hit={hit} now={now} styles={styles} opens />
    </Pressable>
  );
}

interface ResultsProps {
  words: string;
  result: SearchResult;
  styles: SearchStyles;
  onOpen?: (agentId: string) => void;
}

function Results({ words, result, styles, onOpen }: ResultsProps) {
  const now = Date.now();
  return (
    <>
      <Text style={styles.overview}>{overview(result, words)}</Text>
      {result.chats.length === 0 ? null : (
        <View style={styles.section} accessibilityLabel="Chats">
          {result.chats.map((hit) => (
            <HitCard key={hit.sessionId} hit={hit} now={now} styles={styles} onOpen={onOpen} />
          ))}
        </View>
      )}
      {result.others.length === 0 ? null : (
        <View style={styles.section} accessibilityLabel="Not in Paseo">
          <Text style={styles.sectionTitle}>Not in Paseo</Text>
          <Text style={styles.muted}>{OTHERS_INFO}</Text>
          {result.others.map((hit) => (
            <HitCard key={hit.sessionId} hit={hit} now={now} styles={styles} />
          ))}
        </View>
      )}
    </>
  );
}

function Outcome({
  search,
  styles,
  onOpen,
}: Omit<ResultsProps, "words" | "result"> & { search: Search }) {
  if (search.status === "idle") return <Text style={styles.muted}>{HINT}</Text>;
  if (search.status === "loading") return <Text style={styles.muted}>Searching...</Text>;
  if (search.status === "error") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        {search.message}
      </Text>
    );
  }
  return <Results words={search.words} result={search.result} styles={styles} onOpen={onOpen} />;
}

export function SearchScreen({ theme, navigation }: PluginScreenProps) {
  const styles = useSearchStyles(theme);
  const [text, setText] = useState("");
  // What is searched: the field's text once the typing pauses, or at once on Enter.
  const [words, setWords] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setWords(text.trim()), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const submit = useCallback(() => setWords(text.trim()), [text]);
  const search = useChatSearch(words);
  const openAgent = navigation?.openAgent;
  const open = useCallback((agentId: string) => openAgent?.({ agentId }), [openAgent]);
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        placeholder="Words from a chat"
        placeholderTextColor={styles.placeholderColor}
        accessibilityLabel="Search chats"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={MAX_QUERY}
        returnKeyType="search"
        style={styles.field}
      />
      <Outcome search={search} styles={styles} onOpen={openAgent ? open : undefined} />
    </ScrollView>
  );
}
