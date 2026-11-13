import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Loading, ScrollView } from "@getpaseo/plugin/client/ui";
import { designFilesRpc, type FileRow } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { IconButton, PressRow } from "./controls.js";
import { EditorView } from "./editor-view.js";
import { FileSheet, type Sheet } from "./file-sheet.js";
import { hasTouchScreen, readPointer, rowLabel } from "./model.js";
import { useDesignStyles, type DesignStyles } from "./styles.js";

type Listing =
  | { status: "loading" }
  | { status: "off"; reason: string }
  | { status: "ready"; files: FileRow[] }
  | { status: "error"; error: string };

/** How often the list re-reads its rows, so "Opening..." turns into "Open" on its own. */
const REFRESH_MS = 10_000;
const NEW_SHEET: Sheet = { mode: "new" };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function FileRowView(props: {
  file: FileRow;
  styles: DesignStyles;
  onOpen(id: string): void;
  onMore(file: FileRow): void;
}) {
  const { file, styles, onOpen, onMore } = props;
  const label = rowLabel(file);
  const open = useCallback(() => onOpen(file.id), [file.id, onOpen]);
  const more = useCallback(() => onMore(file), [file, onMore]);
  return (
    <View style={styles.rowLine}>
      <PressRow label={`Open ${file.name}, ${label.detail}`} styles={styles} onPress={open}>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {label.title}
          </Text>
          <Text style={styles.detail[label.tone]} numberOfLines={2}>
            {label.detail}
          </Text>
        </View>
      </PressRow>
      <IconButton label={`More for ${file.name}`} icon="Ellipsis" styles={styles} onPress={more} />
    </View>
  );
}

function Empty(props: { title: string; hint: string; styles: DesignStyles; retry?(): void }) {
  const { styles } = props;
  return (
    <View style={styles.emptyBlock}>
      <Text style={styles.emptyTitle}>{props.title}</Text>
      <Text style={styles.emptyHint}>{props.hint}</Text>
      {props.retry ? (
        <ActionButton
          label="Try again"
          pendingLabel="Loading..."
          styles={styles}
          onPress={props.retry}
        />
      ) : null}
    </View>
  );
}

function ListingBody(props: {
  listing: Listing;
  styles: DesignStyles;
  reload(): Promise<void>;
  onOpen(id: string): void;
  onMore(file: FileRow): void;
}) {
  const { listing, styles } = props;
  if (listing.status === "loading") return <Loading />;
  if (listing.status === "off") {
    return <Empty title="Design mode is off on this host" hint={listing.reason} styles={styles} />;
  }
  if (listing.status === "error") {
    return (
      <Empty
        title="Unable to read designs"
        hint={listing.error}
        styles={styles}
        retry={props.reload}
      />
    );
  }
  if (listing.files.length === 0) {
    return (
      <Empty
        title="No designs yet"
        hint="Start one here, or ask an agent in this workspace to design a screen"
        styles={styles}
      />
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {listing.files.map((file) => (
        <FileRowView
          key={file.id}
          file={file}
          styles={styles}
          onOpen={props.onOpen}
          onMore={props.onMore}
        />
      ))}
    </ScrollView>
  );
}

export function DesignsPanel(props: PluginWorkspacePanelProps) {
  const { workspaceId, theme, layout } = props;
  // Asked once for the panel's life, as the office does.
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const styles = useDesignStyles(theme, layout.compact, touchScreen);
  const list = useRpc(designFilesRpc);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);

  const reload = useCallback(async () => {
    try {
      const result = await list({ workspaceId });
      setListing(
        result.enabled
          ? { status: "ready", files: result.files }
          : { status: "off", reason: result.reason },
      );
    } catch (error) {
      setListing({ status: "error", error: messageOf(error) });
    }
  }, [list, workspaceId]);

  useEffect(() => {
    if (openId !== null) return undefined;
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [openId, reload]);

  const startNew = useCallback(() => setSheet(NEW_SHEET), []);
  const showMore = useCallback((file: FileRow) => setSheet({ mode: "file", file }), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const closeEditor = useCallback(() => setOpenId(null), []);
  const changed = useCallback(
    async (created: string | null) => {
      setSheet(null);
      await reload();
      if (created) setOpenId(created);
    },
    [reload],
  );

  const open = listing.status === "ready" ? listing.files.find((f) => f.id === openId) : undefined;
  if (open) return <EditorView {...props} file={open} styles={styles} onClose={closeEditor} />;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLead}>
          <Text style={styles.title} accessibilityRole="header">
            Designs
          </Text>
        </View>
        {listing.status === "ready" ? (
          <ActionButton
            label="New design"
            pendingLabel="New design"
            primary
            styles={styles}
            onPress={startNew}
          />
        ) : null}
      </View>
      <ListingBody
        listing={listing}
        styles={styles}
        reload={reload}
        onOpen={setOpenId}
        onMore={showMore}
      />
      <FileSheet
        sheet={sheet}
        workspaceId={workspaceId}
        styles={styles}
        onClose={closeSheet}
        onChanged={changed}
      />
    </View>
  );
}
