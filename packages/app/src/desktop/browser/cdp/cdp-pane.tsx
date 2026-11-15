import { useCallback, useEffect, memo, useMemo, useRef, useState, type RefObject } from "react";
import { PixelRatio, Text, View, type LayoutChangeEvent } from "react-native";
import { ArrowLeft, ArrowRight, Keyboard, MousePointer2, RotateCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { CdpBrowserNavigateAction } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  appendWorkspaceAttachment,
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useToast } from "@/contexts/toast-context";
import { normalizeWorkspaceBrowserUrl, useBrowserStore } from "@/desktop/browser/store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppVisible } from "@/hooks/use-app-visible";
import { usePointerCapabilities } from "@/hooks/pointer-capabilities";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { CdpAnnotationCard } from "./annotation-card";
import { buildElementAttachment } from "./element-attachment";
import { CdpFrameImage } from "./frame-image";
import { CdpInputLayer } from "./input-layer";
import type { CdpKeyboardHandle } from "./input-layer-types";
import { useCdpTabsStore } from "./tabs-store";
import { reopenCdpTab } from "./tabs-sync";
import { withHttpForHostPort } from "./workspace-browser";
import { useCdpView } from "./use-cdp-view";
import { useElementPick } from "./use-element-pick";
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
const ThemedMousePointer = withUnistyles(MousePointer2);
const ThemedUrlInput = withUnistyles(EditingTextInput);
const iconMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const activeIconMapping = (theme: { colors: { accent: string } }) => ({
  color: theme.colors.accent,
});
const urlInputMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});
const ICON_SIZE = 16;

export interface CdpBrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  /** The workspace's folder; without one a picked element has no composer to go to. */
  cwd: string | null;
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
  /** Absent when the host cannot pick, or the pane has no composer for the element. */
  onTogglePick?: () => void;
  picking: boolean;
  /** No page to pick on, or an agent is using the tab. */
  pickBlocked: boolean;
}

const CdpToolbar = memo(function CdpToolbar({
  browserId,
  blocked,
  urlInputRef,
  onNavigate,
  keyboardOn,
  onKeyboardPressIn,
  onToggleKeyboard,
  onTogglePick,
  picking,
  pickBlocked,
}: ToolbarProps) {
  const { t } = useTranslation();
  // Native always reports a touch screen; on web a mouse-only desktop gets no keyboard button.
  const { touchScreen } = usePointerCapabilities();
  // As in the other pane toolbars: touch-sized hit areas in the compact layout or on a touch screen.
  const compact = useIsCompactFormFactor();
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
        compact={compact}
        disabled={blocked || !record?.canGoBack}
        label={t("workspace.browser.controls.back")}
        onPress={goBack}
      >
        <ThemedArrowLeft size={ICON_SIZE} uniProps={iconMapping} />
      </ToolbarButton>
      <ToolbarButton
        compact={compact}
        disabled={blocked || !record?.canGoForward}
        label={t("workspace.browser.controls.forward")}
        onPress={goForward}
      >
        <ThemedArrowRight size={ICON_SIZE} uniProps={iconMapping} />
      </ToolbarButton>
      <ToolbarButton
        compact={compact}
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
      {onTogglePick ? (
        <ToolbarButton
          compact={compact}
          disabled={pickBlocked}
          label={t(
            picking
              ? "workspace.browser.controls.cancelSelector"
              : "workspace.browser.controls.annotateElement",
          )}
          onPress={onTogglePick}
          selected={picking}
        >
          <ThemedMousePointer
            size={ICON_SIZE}
            uniProps={picking ? activeIconMapping : iconMapping}
          />
        </ToolbarButton>
      ) : null}
      {touchScreen ? (
        <ToolbarButton
          compact={compact}
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
  /** The page is a picker: the next press on it picks an element. */
  picking: boolean;
  onReopen(): void;
  onRetry(): void;
}

function CdpPaneOverlay({
  status,
  hasFrame,
  agentActive,
  reopening,
  reopenFailed,
  picking,
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
      {picking && status === "live" ? (
        <View pointerEvents="none" style={styles.banner}>
          <Text style={styles.bannerText}>{t("cdpBrowser.pickHint")}</Text>
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
  cwd,
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

  // COMPAT(cdpBrowserPick): added in v0.16.0, remove gate after 2027-05-15.
  const canPick = useHostFeature(serverId, "cdpBrowserPick");
  const attachmentScope = useMemo(
    () => (cwd ? buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }) : null),
    [cwd, serverId, workspaceId],
  );
  const { state: pickState, pick } = useElementPick({
    client: canPick && attachmentScope ? client : null,
    browserId,
  });
  const picking = pickState.status === "picking";
  // A picker swallows every press on the page, an agent's too, and a page nobody watches must
  // not stay one.
  const pickBlocked = blocked || frame === null || agentActive;
  const watched = panelActive && appVisible;
  useEffect(() => {
    if (picking && (pickBlocked || !watched)) pick?.stop();
  }, [pick, pickBlocked, picking, watched]);
  // Pressed while a picked element waits for its note, it picks another in its place.
  const togglePick = useCallback(() => {
    if (picking) pick?.stop();
    else pick?.start();
  }, [pick, picking]);
  const stopPick = useCallback(() => pick?.stop(), [pick]);
  const { t } = useTranslation();
  const toast = useToast();
  const attachElement = useCallback(
    (comment: string) => {
      if (pickState.status !== "annotating" || !attachmentScope) return;
      const store = useWorkspaceAttachmentsStore.getState();
      store.setWorkspaceAttachments({
        scopeKey: attachmentScope,
        attachments: appendWorkspaceAttachment(store.attachmentsByScope[attachmentScope] ?? [], {
          kind: "browser_element",
          attachment: buildElementAttachment(pickState.selection, comment),
        }),
      });
      pick?.stop();
      // The composer is often on another tab, so nothing on this one shows the element landed.
      toast.show(t("cdpBrowser.pickAttached"), { variant: "success" });
    },
    [attachmentScope, pick, pickState, t, toast],
  );

  return (
    <View style={styles.container}>
      <CdpToolbar
        blocked={blocked}
        browserId={browserId}
        onNavigate={view.navigate}
        keyboardOn={keyboardOn}
        onKeyboardPressIn={noteKeyboardAtPress}
        onToggleKeyboard={toggleKeyboard}
        onTogglePick={pick ? togglePick : undefined}
        pickBlocked={pickBlocked}
        picking={picking}
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
              viewport={viewport}
            />
          </>
        ) : null}
        <CdpPaneOverlay
          agentActive={agentActive}
          hasFrame={frame !== null}
          onReopen={reopen}
          onRetry={retry}
          picking={picking}
          reopenFailed={reopenError === "failed"}
          reopening={reopening}
          status={status}
        />
        {pickState.status === "annotating" ? (
          <CdpAnnotationCard
            onCancel={stopPick}
            onSubmit={attachElement}
            selection={pickState.selection}
          />
        ) : null}
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
