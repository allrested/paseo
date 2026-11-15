import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  CdpBrowserCookieImportResult,
  CdpBrowserCookieSource,
  CdpBrowserProfile,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import {
  AdaptiveModalSheet,
  SheetHeaderSubtitle,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import {
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useFilePicker } from "@/hooks/use-file-picker";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { decodeUtf8 } from "@/utils/decode-utf8";
import {
  COOKIE_TEXT_MAX_BYTES,
  fileSizeLabel,
  profileErrorKey,
  sitesIn,
  type ProfileManager,
  type ProfileManagerState,
} from "./profile-manager";
import { useProfileManager } from "./use-profile-manager";

/** The select's value for the Shared profile, which has no id. No profile id is this. */
const SHARED = "shared";
const PROFILE_NAME_MAX = 40;

export interface CdpProfileSheetProps {
  visible: boolean;
  onClose(): void;
  /** Null on a host without browser profiles, which has no sheet. */
  client: DaemonClient | null;
  workspaceId: string;
  /** The profile of the tab the sheet was opened from; null is the Shared profile. */
  tabProfile: { id: string; name: string } | null;
}

/** Mounted fresh at each open, so it never shows what an earlier open left behind. */
export function CdpProfileSheet({ visible, client, ...sheet }: CdpProfileSheetProps) {
  if (!visible || !client) return null;
  return <OpenProfileSheet client={client} {...sheet} />;
}

type OpenProfileSheetProps = Omit<CdpProfileSheetProps, "visible" | "client"> & {
  client: DaemonClient;
};

function OpenProfileSheet({ onClose, client, workspaceId, tabProfile }: OpenProfileSheetProps) {
  const { t } = useTranslation();
  const { state, manager } = useProfileManager({ client, workspaceId });
  /** The profile whose import page is up; null is the list. */
  const [target, setTarget] = useState<CdpBrowserProfile | null>(null);
  const backToList = useCallback(() => {
    manager?.clearResult();
    setTarget(null);
  }, [manager]);
  const openImport = useCallback(
    (profile: CdpBrowserProfile) => {
      manager?.clearResult();
      setTarget(profile);
    },
    [manager],
  );
  const header = useMemo<SheetHeader>(
    () =>
      target
        ? {
            title: t("cdpBrowser.profiles.import.title"),
            subtitle: (
              <SheetHeaderSubtitle
                text={t("cdpBrowser.profiles.import.into", { name: target.name })}
              />
            ),
            back: { onPress: backToList, label: t("cdpBrowser.profiles.import.back") },
          }
        : { title: t("cdpBrowser.profiles.title") },
    [backToList, t, target],
  );
  return (
    <AdaptiveModalSheet visible header={header} onClose={onClose} testID="cdp-profile-sheet">
      {target && manager ? (
        <ImportPage manager={manager} state={state} profile={target} />
      ) : (
        <ListPage manager={manager} state={state} tabProfile={tabProfile} onImport={openImport} />
      )}
    </AdaptiveModalSheet>
  );
}

function Failure({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (code === null) return null;
  return (
    <Text accessibilityRole="alert" style={settingsStyles.rowError} testID="cdp-profile-error">
      {t(profileErrorKey(code))}
    </Text>
  );
}

interface ListPageProps {
  manager: ProfileManager | null;
  state: ProfileManagerState;
  tabProfile: { id: string; name: string } | null;
  onImport(profile: CdpBrowserProfile): void;
}

function ListPage({ manager, state, tabProfile, onImport }: ListPageProps) {
  const { t } = useTranslation();
  const sharedName = t("cdpBrowser.profiles.shared");
  const options = useMemo(
    () => [
      { label: sharedName, value: SHARED },
      ...state.profiles.map((profile) => ({ label: profile.name, value: profile.id })),
    ],
    [sharedName, state.profiles],
  );
  const choose = useCallback(
    (value: string) => void manager?.choose(value === SHARED ? null : value),
    [manager],
  );
  const retry = useCallback(() => void manager?.load(), [manager]);
  const remove = useCallback(
    async (profile: CdpBrowserProfile) => {
      const confirmed = await confirmDialog({
        title: t("cdpBrowser.profiles.deleteTitle", { name: profile.name }),
        message: t("cdpBrowser.profiles.deleteMessage"),
        confirmLabel: t("cdpBrowser.profiles.delete"),
        destructive: true,
      });
      if (confirmed) await manager?.remove(profile.id);
    },
    [manager, t],
  );

  if (state.status === "loading" || manager === null) {
    return <Text style={settingsStyles.rowHint}>{t("cdpBrowser.profiles.loading")}</Text>;
  }
  if (state.status === "failed") {
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={settingsStyles.rowError}>
          {t("cdpBrowser.profiles.loadFailed")}
        </Text>
        <Button variant="outline" onPress={retry} style={styles.start}>
          {t("cdpBrowser.profiles.retry")}
        </Button>
      </View>
    );
  }
  const busy = state.busy !== null;
  // A tab keeps the profile it opened in, which a person who just picked another may not expect.
  const tabStays = (tabProfile?.id ?? null) !== state.chosenId;
  return (
    <View style={styles.block}>
      <SettingsCard>
        <SettingsSelect
          label={t("cdpBrowser.profiles.newTabs")}
          hint={
            tabStays
              ? t("cdpBrowser.profiles.thisTab", { name: tabProfile?.name ?? sharedName })
              : undefined
          }
          value={state.chosenId ?? SHARED}
          options={options}
          onValueChange={choose}
          disabled={busy}
          testID="cdp-profile-choice"
        />
      </SettingsCard>
      <SettingsSection title={t("cdpBrowser.profiles.list")} flush>
        <SettingsCard testID="cdp-profile-list">
          {state.profiles.length === 0 ? (
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowHint}>{t("cdpBrowser.profiles.empty")}</Text>
            </View>
          ) : (
            state.profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                disabled={busy}
                onImport={onImport}
                onRemove={remove}
              />
            ))
          )}
          <NewProfileRow manager={manager} busy={state.busy} />
        </SettingsCard>
      </SettingsSection>
      <Failure code={state.error} />
    </View>
  );
}

interface ProfileRowProps {
  profile: CdpBrowserProfile;
  disabled: boolean;
  onImport(profile: CdpBrowserProfile): void;
  onRemove(profile: CdpBrowserProfile): Promise<void>;
}

function ProfileRow({ profile, disabled, onImport, onRemove }: ProfileRowProps) {
  const { t } = useTranslation();
  const startImport = useCallback(() => onImport(profile), [onImport, profile]);
  const remove = useCallback(() => void onRemove(profile), [onRemove, profile]);
  return (
    <SettingsRow label={profile.name} testID={`cdp-profile-${profile.id}`}>
      <View style={styles.actions}>
        <Button
          variant="outline"
          onPress={startImport}
          disabled={disabled}
          accessibilityLabel={t("cdpBrowser.profiles.importInto", { name: profile.name })}
        >
          {t("cdpBrowser.profiles.importCookies")}
        </Button>
        <Button
          variant="ghost"
          onPress={remove}
          disabled={disabled}
          accessibilityLabel={t("cdpBrowser.profiles.deleteLabel", { name: profile.name })}
        >
          {t("cdpBrowser.profiles.delete")}
        </Button>
      </View>
    </SettingsRow>
  );
}

function NewProfileRow({
  manager,
  busy,
}: {
  manager: ProfileManager;
  busy: ProfileManagerState["busy"];
}) {
  const { t } = useTranslation();
  const input = useRef<EditingTextInputHandle>(null);
  const [name, setName] = useState("");
  const add = useCallback(async () => {
    if (name.trim() === "") return;
    // The name stays in the field when the host refuses it, to be corrected.
    if (await manager.add(name)) {
      input.current?.replaceText("");
      setName("");
    }
  }, [manager, name]);
  const submit = useCallback(() => void add(), [add]);
  // The field is the row: its placeholder names it, so a label beside it would say it twice.
  return (
    <View style={styles.newProfile}>
      {/* The wrapper takes the row's free width: the field's own chrome does not grow. */}
      <View style={styles.nameField}>
        <FormTextInput
          ref={input}
          initialValue=""
          onChangeText={setName}
          onSubmitEditing={submit}
          placeholder={t("cdpBrowser.profiles.newProfile")}
          accessibilityLabel={t("cdpBrowser.profiles.newProfile")}
          maxLength={PROFILE_NAME_MAX}
          autoCapitalize="words"
          autoCorrect={false}
          editable={busy === null}
          testID="cdp-profile-name"
        />
      </View>
      <Button
        variant="default"
        onPress={submit}
        disabled={busy !== null || name.trim() === ""}
        loading={busy === "add"}
        testID="cdp-profile-add"
      >
        {t("cdpBrowser.profiles.add")}
      </Button>
    </View>
  );
}

type ImportMode = "file" | "shared";

interface PickedFile {
  name: string;
  bytes: number;
  text: string;
}

/** The source the page's fields describe, or null while they describe none. */
function sourceOf(input: {
  mode: ImportMode;
  file: PickedFile | null;
  pasted: string;
  sites: string;
}): CdpBrowserCookieSource | null {
  if (input.mode === "shared") {
    const sites = sitesIn(input.sites);
    return sites.length === 0 ? null : { kind: "shared", sites };
  }
  const text = input.file?.text ?? input.pasted;
  return text.trim() === "" ? null : { kind: "text", text };
}

function ImportPage({
  manager,
  state,
  profile,
}: {
  manager: ProfileManager;
  state: ProfileManagerState;
  profile: CdpBrowserProfile;
}) {
  const { t } = useTranslation();
  const { pickFiles } = useFilePicker();
  const [mode, setMode] = useState<ImportMode>("file");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [pasted, setPasted] = useState("");
  const [sites, setSites] = useState("");
  /** A file that could not be used, as one of the daemon's codes or "file" for one not read. */
  const [fileError, setFileError] = useState<string | null>(null);
  const modes = useMemo<SegmentedControlOption<ImportMode>[]>(
    () => [
      { value: "file", label: t("cdpBrowser.profiles.import.sourceFile") },
      { value: "shared", label: t("cdpBrowser.profiles.import.sourceShared") },
    ],
    [t],
  );
  const changeMode = useCallback(
    (next: ImportMode) => {
      manager.clearResult();
      setFileError(null);
      setMode(next);
    },
    [manager],
  );
  const choose = useCallback(async () => {
    setFileError(null);
    try {
      const picked = (await pickFiles())?.[0];
      if (!picked) return;
      const bytes = await picked.readBytes();
      // The daemon refuses a larger text, so it is not sent.
      if (bytes.byteLength > COOKIE_TEXT_MAX_BYTES) {
        setFileError("browser_cookies_too_large");
        return;
      }
      manager.clearResult();
      setFile({ name: picked.fileName, bytes: bytes.byteLength, text: decodeUtf8(bytes) });
    } catch {
      setFileError("file");
    }
  }, [manager, pickFiles]);
  const chooseFile = useCallback(() => void choose(), [choose]);
  const source = sourceOf({ mode, file, pasted, sites });
  /** Counts the imports that went in: the text field is made anew after each, which empties it. */
  const [imports, setImports] = useState(0);
  const run = useCallback(
    async (from: CdpBrowserCookieSource) => {
      await manager.importCookies(profile.id, from);
      // Cookies that went in are not left on screen. A refused text stays, to be corrected.
      if (from.kind !== "text" || manager.getState().imported === null) return;
      setFile(null);
      setPasted("");
      setImports((count) => count + 1);
    },
    [manager, profile.id],
  );
  const submit = useCallback(() => {
    if (source) void run(source);
  }, [run, source]);
  const importing = state.busy === "import";

  return (
    <View style={styles.block}>
      <SegmentedControl
        options={modes}
        value={mode}
        onValueChange={changeMode}
        testID="cdp-profile-import-mode"
      />
      {mode === "file" ? (
        <>
          <SettingsCard>
            <SettingsRow
              label={file ? file.name : t("cdpBrowser.profiles.import.file")}
              hint={file ? fileSizeLabel(file.bytes) : t("cdpBrowser.profiles.import.fileHint")}
            >
              <Button variant="outline" onPress={chooseFile} disabled={importing}>
                {t(
                  file ? "cdpBrowser.profiles.import.change" : "cdpBrowser.profiles.import.choose",
                )}
              </Button>
            </SettingsRow>
          </SettingsCard>
          {file ? null : (
            <SettingsTextAreaCard
              key={imports}
              accessibilityLabel={t("cdpBrowser.profiles.import.pasteLabel")}
              placeholder={t("cdpBrowser.profiles.import.paste")}
              value=""
              onChangeText={setPasted}
              testID="cdp-profile-import-text"
            />
          )}
        </>
      ) : (
        <SettingsCard>
          <SettingsInput
            label={t("cdpBrowser.profiles.import.sites")}
            hint={t("cdpBrowser.profiles.import.sitesHint")}
            placeholder={t("cdpBrowser.profiles.import.sitesPlaceholder")}
            initialValue=""
            onChangeText={setSites}
            disabled={importing}
            testID="cdp-profile-import-sites"
          />
        </SettingsCard>
      )}
      <Button
        variant="default"
        onPress={submit}
        disabled={source === null || state.busy !== null}
        loading={importing}
        style={styles.start}
        testID="cdp-profile-import-submit"
      >
        {t(
          importing ? "cdpBrowser.profiles.import.importing" : "cdpBrowser.profiles.import.submit",
        )}
      </Button>
      {fileError === "file" ? (
        <Text accessibilityRole="alert" style={settingsStyles.rowError}>
          {t("cdpBrowser.profiles.import.fileUnreadable")}
        </Text>
      ) : (
        <Failure code={fileError ?? state.error} />
      )}
      {state.imported ? <ImportResult result={state.imported} /> : null}
    </View>
  );
}

function ImportResult({ result }: { result: CdpBrowserCookieImportResult }) {
  const { t } = useTranslation();
  const named = result.sites.join(", ");
  const more = result.siteCount - result.sites.length;
  const sites =
    more > 0 ? t("cdpBrowser.profiles.import.moreSites", { sites: named, count: more }) : named;
  return (
    <Text accessibilityLiveRegion="polite" style={styles.result} testID="cdp-profile-import-result">
      {t("cdpBrowser.profiles.import.imported", { count: result.imported, sites })}
      {result.skipped > 0
        ? ` ${t("cdpBrowser.profiles.import.skipped", { count: result.skipped })}`
        : ""}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: {
    gap: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  newProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  nameField: {
    flex: 1,
    minWidth: 0,
  },
  start: {
    alignSelf: "flex-start",
  },
  result: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
