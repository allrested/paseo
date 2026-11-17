import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ScriptFrameHandle, ScriptFrameProps } from "@getpaseo/plugin/client/ui";
import {
  SCRIPT_FRAME_BASE_URL,
  createPostQueue,
  deliverScript,
  parsePageMessage,
  routePageMessage,
  scriptFrameHtml,
} from "./script-frame-page";

const frameStyle = { flex: 1, backgroundColor: "transparent" };
// react-native-webview checks this list before `onShouldStartLoadWithRequest` and hands a URL
// that fails it to `Linking.openURL`, so a narrow list opens the page's navigations in the system
// browser. Matching everything sends every URL through `allowLoad`.
const originWhitelist = ["*"];

/**
 * Runs a plugin's script in a WebView with JavaScript and `localStorage` on and nothing else: no
 * files, no windows, no network (the page's policy), and no load after the first.
 */
export const ScriptFrame = forwardRef<ScriptFrameHandle, ScriptFrameProps>(function ScriptFrame(
  { script, onMessage, onError, title, testID },
  ref,
) {
  const webView = useRef<WebView | null>(null);
  const queue = useMemo(
    () => createPostQueue((text) => webView.current?.injectJavaScript(deliverScript(text))),
    [],
  );
  const html = useMemo(() => scriptFrameHtml(script, "native"), [script]);
  const source = useMemo(() => ({ html, baseUrl: SCRIPT_FRAME_BASE_URL }), [html]);
  const firstLoad = useRef(true);
  const handlers = useRef({ onMessage, onError });
  useEffect(() => {
    handlers.current = { onMessage, onError };
  });
  // A new script is a new page: it is not ready, and its first load is allowed again.
  useEffect(() => {
    queue.reset();
    firstLoad.current = true;
  }, [html, queue]);
  useImperativeHandle(ref, () => ({ post: queue.post }), [queue]);

  const allowLoad = useCallback((request: { url: string }) => {
    if (request.url !== SCRIPT_FRAME_BASE_URL || !firstLoad.current) return false;
    firstLoad.current = false;
    return true;
  }, []);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      const message = parsePageMessage(value);
      if (message === null) return;
      routePageMessage(message, queue, {
        onMessage: (text) => handlers.current.onMessage(text),
        onError: (text) => handlers.current.onError?.(text),
      });
    },
    [queue],
  );
  const handleError = useCallback((event: { nativeEvent: { description: string } }) => {
    handlers.current.onError?.(event.nativeEvent.description);
  }, []);
  const handleProcessGone = useCallback(() => {
    handlers.current.onError?.("The page's process ended");
  }, []);

  return (
    <WebView
      ref={webView}
      testID={testID}
      accessibilityLabel={title}
      style={frameStyle}
      source={source}
      originWhitelist={originWhitelist}
      onShouldStartLoadWithRequest={allowLoad}
      onMessage={handleMessage}
      onError={handleError}
      onRenderProcessGone={handleProcessGone}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      thirdPartyCookiesEnabled={false}
      mediaPlaybackRequiresUserAction
    />
  );
});
