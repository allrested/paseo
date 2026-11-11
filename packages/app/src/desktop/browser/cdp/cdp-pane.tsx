import { useCallback, useEffect, memo, useMemo, useRef, useState, type RefObject } from "react";
import { PixelRatio, Text, View, type LayoutChangeEvent } from "react-native";
import { ArrowLeft, ArrowRight, Keyboard, RotateCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { CdpBrowserNavigateAction } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { normalizeWorkspaceBrowserUrl, useBrowserStore } from "@/desktop/browser/store";
import { useAppVisible } from "@/hooks/use-app-visible";
import { usePointerCapabilities } from "@/hooks/pointer-capabilities";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { CdpFrameImage } from "./frame-image";
import { CdpInputLayer } from "./input-layer";
import type { CdpKeyboardHandle } from "./input-layer-types";
import { useCdpTabsStore } from "./tabs-store";
import { reopenCdpTab } from "./tabs-sync";
import { withHttpForHostPort } from "./workspace-browser";
import { useCdpView } from "./use-cdp-view";
import {
  fitFrame,
  viewStatusForError,
  viewportForPane,
  type CdpViewStatus,
  type Size,
} from "./view-model";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedKeyboard = withUnistyles(Keyboard);
const ThemedUrlInput = withUnistyles(EditingTextInput);
const iconMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const urlInputMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});
const ICON_SIZE = 16;

export interface CdpBrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  onFocusPane?: () => void;
}

interface ToolbarProps {
  browserId: string;
  blocked: boolean;
  urlInputRef: RefObject<EditingTextInputHandle | null>;
  onNavigate(action: CdpBrowserNavigateAction): void;
  keyboardOn: boolean;
  onKeyboardPressIn(): void;
  onToggleKeyboard(): void;
}

const CdpToolbar = memo(function CdpToolbar({
  browserId,
  blocked,
  urlInputRef,
  onNavigate,
  keyboardOn,
  onKeyboardPressIn,
  onToggleKeyboard,
}: ToolbarProps) {
  const { t } = useTranslation();
  // Native always reports a touch screen; on web a mouse-only desktop gets no keyboard button.
  const { touchScreen } = usePointerCapabilities();
  const record = useBrowserStore((state) => state.browsersById[browserId] ?? null);
  const url = record?.url ?? "";
  const editing = useRef(false);
  // The URL field shows the tab's URL until the user edits it.
  useEffect(() => {
    if (!editing.current) urlInputRef.current?.replaceText(url);
  }, [url, urlInputRef]);
  const handleUrlFocus = useCallback(() => {
    editing.current = true;
  }, []);
  const handleUrlBlur = useCallback(() => {
    editing.current = false;
    urlInputRef.current?.replaceText(url);
  }, [url, urlInputRef]);
  const submitUrl = useCallback(() => {
    const draft = urlInputRef.current?.getText() ?? "";
    onNavigate({ kind: "url", url: normalizeWorkspaceBrowserUrl(withHttpForHostPort(draft)) });
    urlInputRef.current?.blur();
  }, [onNavigate, urlInputRef]);
  const goBack = useCallback(() => onNavigate({ kind: "back" }), [onNavigate]);
  const goForward = useCallback(() => onNavigate({ kind: "forward" }), [onNavigate]);
  const reload = useCallback(() => onNavigate({ kind: "reload" }), [onNavigate]);

  return (
    <View style={styles.toolbar}>
      <ToolbarButton
        disabled={blocked || !record?.canGoBack}
        label={t("workspace.browser.controls.back")}
        onPress={goBack}
      >
        <ThemedArrowLeft size={ICON_SIZE} uniProps={iconMapping} />
      </ToolbarButton>
      <ToolbarButton
        disabled={blocked || !record?.canGoForward}
        label={t("workspace.browser.controls.forward")}
        onPress={goForward}
      >
        <ThemedArrowRight size={ICON_SIZE} uniProps={iconMapping} />
      </ToolbarButton>
      <ToolbarButton
        disabled={blocked}
        label={t("workspace.browser.controls.refresh")}
        onPress={reload}
      >
        <ThemedRotateCw size={ICON_SIZE} uniProps={iconMapping} />
      </ToolbarButton>
      <ThemedUrlInput
        ref={urlInputRef}
        accessibilityLabel={t("workspace.browser.controls.browserUrl")}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!blocked}
        initialValue={url}
        keyboardType="url"
        onBlur={handleUrlBlur}
        onFocus={handleUrlFocus}
        onSubmitEditing={submitUrl}
        placeholder={t("workspace.browser.controls.enterUrl")}
        selectTextOnFocus
        style={styles.urlInput}
        uniProps={urlInputMapping}
      />
      {touchScreen ? (
        <ToolbarButton
          disabled={blocked}
          label={t("cdpBrowser.keyboard")}
          onPress={onToggleKeyboard}
          onPressIn={onKeyboardPressIn}
          selected={keyboardOn}
        >
          <ThemedKeyboard size={ICON_SIZE} uniProps={iconMapping} />
        </ToolbarButton>
      ) : null}
    </View>
  );
});

interface OverlayProps {
  status: CdpViewStatus;
  hasFrame: boolean;
  agentActive: boolean;
  reopening: boolean;
  reopenFailed: boolean;
  onReopen(): void;
  onRetry(): void;
}

function CdpPaneOverlay({
  status,
  hasFrame,
  agentActive,
  reopening,
  reopenFailed,
  onReopen,
  onRetry,
}: OverlayProps) {
  const { t } = useTranslation();
  return (
    <>
      {status === "connecting" && !hasFrame ? (
        <View style={styles.message}>
          <Text style={styles.messageText}>{t("cdpBrowser.connecting")}</Text>
        </View>
      ) : null}
      {status === "closed" ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>{t("cdpBrowser.closed.title")}</Text>
          {reopenFailed ? (
            <Text style={styles.messageText}>{t("cdpBrowser.closed.reopenFailed")}</Text>
          ) : null}
          <Button disabled={reopening} onPress={onReopen}>
            {t("cdpBrowser.closed.reopen")}
          </Button>
        </View>
      ) : null}
      {status === "unreachable" ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>{t("cdpBrowser.unreachable.title")}</Text>
          <Button onPress={onRetry}>{t("cdpBrowser.unreachable.retry")}</Button>
        </View>
      ) : null}
      {status === "unresponsive" ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t("cdpBrowser.unresponsive")}</Text>
          <Button size="sm" onPress={onRetry}>
            {t("cdpBrowser.unreachable.retry")}
          </Button>
        </View>
      ) : null}
      {agentActive && status !== "closed" && status !== "unreachable" ? (
        <View pointerEvents="none" style={styles.badge}>
          <Text style={styles.bannerText}>{t("cdpBrowser.agentActive")}</Text>
        </View>
      ) : null}
    </>
  );
}

export function CdpBrowserPane({
  browserId,
  serverId,
  workspaceId,
  onFocusPane,
}: CdpBrowserPaneProps) {
  const rawClient = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "cdpBrowser");
  // The client throws on a host without the feature, so such a host gets no client at all.
  const client = supported ? rawClient : null;
  const panelActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const hostConnected = useCdpTabsStore((state) => state.hosts[serverId]?.connected ?? false);
  const agentActive = useCdpTabsStore(
    (state) => (state.hosts[serverId]?.tabs[browserId]?.agentActiveUntil ?? null) !== null,
  );

  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  const viewport = useMemo(() => viewportForPane(size, PixelRatio.get()), [size]);

  const view = useCdpView({
    client,
    browserId,
    active: panelActive && appVisible,
    viewport,
    hostConnected,
    agentActive,
  });
  const [reopenError, setReopenError] = useState<"failed" | "unreachable" | null>(null);
  let status: CdpViewStatus = supported ? view.status : "unreachable";
  if (reopenError === "unreachable") status = "unreachable";
  const { frame } = view;
  const page = useMemo<Size>(
    () => ({ width: frame?.deviceWidth ?? 0, height: frame?.deviceHeight ?? 0 }),
    [frame?.deviceWidth, frame?.deviceHeight],
  );
  const rect = useMemo(() => fitFrame(size, page), [size, page]);

  const urlInput = useRef<EditingTextInputHandle>(null);
  const focusUrl = useCallback(() => urlInput.current?.focus(), []);
  const keyboard = useRef<CdpKeyboardHandle>(null);
  const [keyboardOn, setKeyboardOn] = useState(false);
  // On web the button takes focus before its press fires, which turns the keyboard off; the state
  // read at press-in is what the user saw.
  const keyboardAtPress = useRef<boolean | null>(null);
  const noteKeyboardAtPress = useCallback(() => {
    keyboardAtPress.current = keyboard.current?.isOn() ?? false;
  }, []);
  // Called inside the press, so iOS Safari raises the keyboard for the field's focus().
  const toggleKeyboard = useCallback(() => {
    const wasOn = keyboardAtPress.current ?? keyboard.current?.isOn() ?? false;
    keyboardAtPress.current = null;
    if (wasOn) keyboard.current?.hide();
    else keyboard.current?.show();
  }, []);

  const [reopening, setReopening] = useState(false);
  const reopen = useCallback(() => {
    if (!client || reopening) return;
    setReopening(true);
    setReopenError(null);
    reopenCdpTab({ client, serverId, workspaceId, browserId })
      .catch((error: unknown) => {
        const unreachable =
          viewStatusForError(error instanceof Error ? error.message : String(error)) ===
          "unreachable";
        setReopenError(unreachable ? "unreachable" : "failed");
      })
      .finally(() => setReopening(false));
  }, [browserId, client, reopening, serverId, workspaceId]);

  const { retry: retryView } = view;
  const retry = useCallback(() => {
    setReopenError(null);
    retryView();
  }, [retryView]);

  const blocked = status === "closed" || status === "unreachable";

  return (
    <View style={styles.container}>
      <CdpToolbar
        blocked={blocked}
        browserId={browserId}
        onNavigate={view.navigate}
        keyboardOn={keyboardOn}
        onKeyboardPressIn={noteKeyboardAtPress}
        onToggleKeyboard={toggleKeyboard}
        urlInputRef={urlInput}
      />
      <View onLayout={handleLayout} style={styles.viewport}>
        {frame && !blocked ? (
          <>
            <CdpFrameImage jpeg={frame.jpeg} rect={rect} />
            <CdpInputLayer
              keyboardRef={keyboard}
              onKeyboardChange={setKeyboardOn}
              onFocusPane={onFocusPane}
              onFocusUrl={focusUrl}
              onInput={view.sendInput}
              page={page}
              rect={rect}
            />
          </>
        ) : null}
        <CdpPaneOverlay
          agentActive={agentActive}
          hasFrame={frame !== null}
          onReopen={reopen}
          onRetry={retry}
          reopenFailed={reopenError === "failed"}
          reopening={reopening}
          status={status}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  urlInput: {
    flex: 1,
    minWidth: 0,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: theme.colors.surface1,
  },
  message: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 16,
  },
  messageTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  messageText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  banner: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  badge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bannerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
