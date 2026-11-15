import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import { createElementPick, type ElementPick, type ElementPickState } from "./element-pick";

const IDLE: ElementPickState = { status: "idle" };

/**
 * The element pick of one pane's tab. Callers pass a null `client` for a host that cannot pick.
 * The pick ends when the pane goes away, so the page is not left a picker.
 */
export function useElementPick(input: { client: DaemonClient | null; browserId: string }): {
  state: ElementPickState;
  pick: ElementPick | null;
} {
  const { client, browserId } = input;
  const [state, setState] = useState<ElementPickState>(IDLE);
  const { t } = useTranslation();
  const toast = useToast();
  // Read when a pick fails, so a new toast or translator does not make a new pick.
  const report = useRef((_reason: "loading" | "failed") => {});
  report.current = (reason) =>
    toast.error(
      t(
        reason === "loading"
          ? "workspace.browser.controls.selectorLoading"
          : "workspace.browser.controls.selectorFailed",
      ),
    );
  const pick = useMemo(
    () =>
      client
        ? createElementPick({
            pick: () => client.pickCdpBrowserElement(browserId),
            cancel: () => client.cancelCdpBrowserElementPick(browserId),
            onState: setState,
            onFailure: (reason) => report.current(reason),
          })
        : null,
    [client, browserId],
  );
  useEffect(() => () => pick?.stop(), [pick]);
  return { state, pick };
}
