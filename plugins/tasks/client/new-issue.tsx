import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  DESCRIPTION_MAX,
  SOURCE_NAME,
  TITLE_MAX,
  createTaskRpc,
  kindsRpc,
  placesRpc,
  sourcesRpc,
  type Choice,
  type Source,
  type TrackerChoice,
} from "../shared/contracts.js";
import { Button } from "./button.js";
import { useDebounced } from "./device.js";
import { descriptionHint, placeName } from "./format.js";
import { reason } from "./reason.js";
import type { TasksStyles } from "./tasks-styles.js";
import { refreshLists } from "./use-tasks.js";

const SEARCH_DELAY_MS = 300;
/** The kind a Jira project's new issue starts as, when the project has it. */
const USUAL_KIND = "Task";

// Issues tend to go to one place: the next form starts where the last issue went.
let last: { source: Source; place: Choice } | null = null;

/** For tests: where one test's issue went must not fill the next form. */
export function forgetPlace(): void {
  last = null;
}

interface Styled {
  styles: TasksStyles;
}

const NO_KEYS = {};

/**
 * A browser's own checkbox and radio answer to Space, and the app's Pressable gives them Enter
 * only. Native has no such key here.
 */
function spaceKey(press: () => void): object {
  if (typeof document === "undefined") return NO_KEYS;
  return {
    onKeyDown(event: { key: string; preventDefault(): void }) {
      if (event.key !== " ") return;
      // Space would also scroll the page.
      event.preventDefault();
      press();
    },
  };
}

interface ChipProps extends Styled {
  id: string;
  label: string;
  selected: boolean;
  onPick(id: string): void;
}

function Chip({ id, label, selected, onPick, styles }: ChipProps) {
  const pick = useCallback(() => onPick(id), [onPick, id]);
  const keys = useMemo(() => spaceKey(pick), [pick]);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      selected ? styles.chipSelected : styles.chip,
      pressed ? styles.pressed : null,
    ],
    [selected, styles],
  );
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      onPress={pick}
      style={style}
      {...keys}
    >
      {/* The mark, so the pick does not rest on a fill alone. */}
      {selected ? <Icon name="Check" size={14} color={styles.chipMarkColor} /> : null}
      <Text style={selected ? styles.chipTextSelected : styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface ChipsProps extends Styled {
  label: string;
  choices: readonly Choice[];
  selected: string | null;
  onPick(id: string): void;
}

function Chips({ label, choices, selected, onPick, styles }: ChipsProps) {
  return (
    <View accessibilityRole="radiogroup" aria-label={label} style={styles.chips}>
      {choices.map((choice) => (
        <Chip
          key={choice.id}
          id={choice.id}
          label={choice.label}
          selected={choice.id === selected}
          onPick={onPick}
          styles={styles}
        />
      ))}
    </View>
  );
}

interface PlaceRowProps extends Styled {
  place: Choice;
  first: boolean;
  onPick(place: Choice): void;
}

function PlaceRow({ place, first, onPick, styles }: PlaceRowProps) {
  const pick = useCallback(() => onPick(place), [onPick, place]);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      first ? styles.row : styles.rowDivided,
      pressed ? styles.rowSelected : null,
    ],
    [first, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={place.label}
      onPress={pick}
      style={style}
    >
      <Text style={styles.rowTitle} numberOfLines={1}>
        {place.label}
      </Text>
    </Pressable>
  );
}

interface PlacePickerProps extends Styled {
  source: Source;
  onPick(place: Choice): void;
}

/** The projects or repositories of one tracker, narrowed by what is typed. */
function PlacePicker({ source, onPick, styles }: PlacePickerProps) {
  const read = useRpc(placesRpc);
  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), SEARCH_DELAY_MS);
  const places = useQuery({
    queryKey: ["tasks", "places", source, query],
    queryFn: () => read({ source, query }),
    // The rows of the words before stay up while these load, so the list does not blink.
    placeholderData: keepPreviousData,
    retry: false,
  });
  const name = placeName(source);
  const { refetch } = places;
  const again = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const found = places.data?.places ?? null;
  let body;
  if (places.isError) {
    body = (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.error}>
          {reason(places.error)}
        </Text>
        <Button label="Try again" onPress={again} styles={styles} />
      </View>
    );
  } else if (found === null) {
    body = <Text style={styles.muted}>Loading...</Text>;
  } else if (found.length === 0) {
    body = (
      <Text style={styles.muted}>
        {query === ""
          ? `The saved account sees no ${name.many}`
          : `No ${name.one} matches "${query}"`}
      </Text>
    );
  } else {
    body = (
      <View style={styles.card}>
        {found.map((place, index) => (
          <PlaceRow
            key={place.id}
            place={place}
            first={index === 0}
            onPick={onPick}
            styles={styles}
          />
        ))}
      </View>
    );
  }
  return (
    <>
      <TextInput
        accessibilityLabel={`Search ${name.many}`}
        value={text}
        onChangeText={setText}
        placeholder={`Search ${name.many}`}
        placeholderTextColor={styles.placeholderColor}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.field}
      />
      {body}
    </>
  );
}

interface KindPickerProps extends Styled {
  source: Source;
  place: string;
  kind: string | null;
  onPick(kind: string): void;
}

/** The kinds of issue the picked project takes. The usual one is picked to start with. */
function KindPicker({ source, place, kind, onPick, styles }: KindPickerProps) {
  const read = useRpc(kindsRpc);
  const kinds = useQuery({
    queryKey: ["tasks", "kinds", source, place],
    queryFn: () => read({ source, place }),
    retry: false,
  });
  const found = kinds.data?.kinds;
  useEffect(() => {
    if (found === undefined || found.length === 0) return;
    if (found.some((each) => each.id === kind)) return;
    onPick((found.find((each) => each.label === USUAL_KIND) ?? found[0]).id);
  }, [found, kind, onPick]);
  const { refetch } = kinds;
  const again = useCallback(async () => {
    await refetch();
  }, [refetch]);
  if (kinds.isError) {
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.error}>
          {reason(kinds.error)}
        </Text>
        <Button label="Try again" onPress={again} styles={styles} />
      </View>
    );
  }
  if (found === undefined) return <Text style={styles.muted}>Loading...</Text>;
  if (found.length === 0) {
    return <Text style={styles.muted}>This project takes no kind of issue from this account</Text>;
  }
  return <Chips label="Kind" choices={found} selected={kind} onPick={onPick} styles={styles} />;
}

interface FormProps extends Styled {
  trackers: readonly TrackerChoice[];
  onCreated(id: string): void;
  onCancel(): void;
}

function Form({ trackers, onCreated, onCancel, styles }: FormProps) {
  const create = useRpc(createTaskRpc);
  const toast = useToast();
  // Where the last issue went, when its tracker is still connected. Read as the form opens.
  const [start] = useState(() =>
    trackers.some((each) => each.source === last?.source) ? last : null,
  );
  const [source, setSource] = useState<Source>(start?.source ?? trackers[0].source);
  const [place, setPlace] = useState<Choice | null>(start?.place ?? null);
  const [kind, setKind] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assign, setAssign] = useState(true);
  // Shown above both buttons: under its own, a long reason would push Cancel to the next line.
  const [refusal, setRefusal] = useState<string | null>(null);
  const tracker = trackers.find((each) => each.source === source) ?? trackers[0];
  const choices = useMemo(
    () => trackers.map((each) => ({ id: each.source, label: SOURCE_NAME[each.source] })),
    [trackers],
  );
  const pickSource = useCallback(
    (id: string) => {
      const picked = trackers.find((each) => each.source === id);
      if (!picked || picked.source === source) return;
      setSource(picked.source);
      setPlace(null);
      setKind(null);
    },
    [trackers, source],
  );
  const pickPlace = useCallback((picked: Choice) => {
    setPlace(picked);
    setKind(null);
  }, []);
  const changePlace = useCallback(() => {
    setPlace(null);
    setKind(null);
  }, []);
  const toggleAssign = useCallback(() => setAssign((on) => !on), []);
  const assignKeys = useMemo(() => spaceKey(toggleAssign), [toggleAssign]);
  const name = placeName(source);
  const ready = place !== null && title.trim() !== "" && (!tracker.kinds || kind !== null);
  const submit = useCallback(async () => {
    if (place === null) return;
    setRefusal(null);
    let made;
    try {
      made = await create({
        source,
        place: place.id,
        ...(tracker.kinds && kind !== null ? { kind } : {}),
        title,
        description,
        assign,
      });
    } catch (error) {
      setRefusal(reason(error));
      return;
    }
    last = { source, place };
    // Left empty behind the new task's page: going back must not offer the same issue again.
    setTitle("");
    setDescription("");
    refreshLists();
    if (made.warning !== undefined) toast.show(made.warning);
    onCreated(made.id);
  }, [create, source, place, tracker.kinds, kind, title, description, assign, toast, onCreated]);
  const checkStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.check, pressed ? styles.pressed : null],
    [styles],
  );
  return (
    <>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>{`${SOURCE_NAME[source]} issue`}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          New issue
        </Text>
      </View>
      {trackers.length < 2 ? null : (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Tracker</Text>
          <Chips
            label="Tracker"
            choices={choices}
            selected={source}
            onPick={pickSource}
            styles={styles}
          />
        </View>
      )}
      <View style={styles.block}>
        <Text style={styles.sectionTitle}>{name.title}</Text>
        {place === null ? (
          // Keyed by the tracker: what was typed for one is not searched in the next.
          <PlacePicker key={source} source={source} onPick={pickPlace} styles={styles} />
        ) : (
          <View style={styles.picked}>
            <Text style={styles.pickedText} numberOfLines={2}>
              {place.label}
            </Text>
            <Button label={`Change ${name.one}`} onPress={changePlace} styles={styles} />
          </View>
        )}
      </View>
      {!tracker.kinds || place === null ? null : (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Kind</Text>
          <KindPicker
            source={source}
            place={place.id}
            kind={kind}
            onPick={setKind}
            styles={styles}
          />
        </View>
      )}
      <View style={styles.block}>
        <Text style={styles.sectionTitle}>Title</Text>
        <TextInput
          accessibilityLabel="Title"
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
          style={styles.field}
        />
      </View>
      <View style={styles.block}>
        <Text style={styles.sectionTitle}>Description</Text>
        <TextInput
          accessibilityLabel="Description"
          value={description}
          onChangeText={setDescription}
          maxLength={DESCRIPTION_MAX}
          multiline
          style={styles.input}
        />
        <Text style={styles.rowMeta}>{descriptionHint(source)}</Text>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Assign to me"
        aria-checked={assign}
        onPress={toggleAssign}
        style={checkStyle}
        {...assignKeys}
      >
        <View style={assign ? styles.checkBoxOn : styles.checkBox}>
          {assign ? <Icon name="Check" size={14} color={styles.checkMarkColor} /> : null}
        </View>
        <Text style={styles.rowTitle}>Assign to me</Text>
      </Pressable>
      <View style={styles.block}>
        <Text style={styles.rowMeta}>
          {`Made in ${SOURCE_NAME[source]} as the account saved on this host`}
        </Text>
        {refusal === null ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {refusal}
          </Text>
        )}
        <View style={styles.actions}>
          <Button
            label="Create issue"
            pendingLabel="Creating..."
            onPress={submit}
            disabled={!ready}
            styles={styles}
            primary
          />
          <Button label="Cancel" onPress={onCancel} styles={styles} />
        </View>
      </View>
    </>
  );
}

export interface NewIssueProps extends Styled {
  /** Returns to the list, where the form covers it and the host's header has no way back. */
  onBack?: () => void;
  /** The issue is made: its id is the task to show. */
  onCreated(id: string): void;
  onCancel(): void;
  /** Opens the screen where the trackers are connected. */
  onConnect(): void;
}

/** A form that makes an issue in one of the connected trackers. */
export function NewIssue({ styles, onBack, onCreated, onCancel, onConnect }: NewIssueProps) {
  const read = useRpc(sourcesRpc);
  const sources = useQuery({
    queryKey: ["tasks", "sources"],
    queryFn: () => read({}),
    retry: false,
  });
  const { refetch } = sources;
  const again = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const backStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.backPressed : styles.back),
    [styles],
  );
  const trackers = sources.data?.sources;
  let body;
  if (trackers === undefined) {
    body = sources.isError ? (
      <View style={styles.empty}>
        <Text accessibilityRole="alert" style={styles.emptyText}>
          {reason(sources.error)}
        </Text>
        <Button label="Try again" onPress={again} styles={styles} />
      </View>
    ) : (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading...</Text>
      </View>
    );
  } else if (trackers.length === 0) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No tracker is connected</Text>
        <Button label="Connect Jira, GitLab or GitHub" onPress={onConnect} styles={styles} />
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
        <Form trackers={trackers} onCreated={onCreated} onCancel={onCancel} styles={styles} />
      </ScrollView>
    );
  }
  if (onBack === undefined) return body;
  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the list"
        onPress={onBack}
        style={backStyle}
      >
        <Icon name="ChevronLeft" size={16} color={styles.iconColor} />
        <Text style={styles.muted}>All tasks</Text>
      </Pressable>
      {body}
    </View>
  );
}
