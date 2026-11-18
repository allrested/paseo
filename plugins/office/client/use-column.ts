import { useCallback, useMemo, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeColumnSettings } from "../shared/settings.js";
import { COLUMN_DEFAULT, type ColumnTab } from "./column-model.js";

interface ColumnValues {
  width: number;
  collapsed: boolean;
}

const DEFAULTS: ColumnValues = { width: COLUMN_DEFAULT, collapsed: false };

export interface ColumnState {
  tab: ColumnTab;
  /** The stored width, not yet clamped to a surface. */
  width: number;
  collapsed: boolean;
  /** Selects the tab and opens a collapsed column. */
  show(tab: ColumnTab): void;
  setCollapsed(next: boolean): void;
  setWidth(next: number): void;
}

/**
 * The column's state. The tab lives as long as the surface; the width and collapsed are the
 * device's. A change shows at once and is saved behind it; one the device refuses holds until the
 * office is closed.
 */
export function useColumn(): ColumnState {
  const settings = useSettings(officeColumnSettings);
  const stored = settings.status === "ready" ? settings.values : null;
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save } = settings;
  const [local, setLocal] = useState<Partial<ColumnValues>>({});
  const [tab, setTab] = useState<ColumnTab>("sessions");
  const width = local.width ?? stored?.width ?? DEFAULTS.width;
  const collapsed = local.collapsed ?? stored?.collapsed ?? DEFAULTS.collapsed;
  const change = useCallback(
    (patch: Partial<ColumnValues>) => {
      setLocal((current) => ({ ...current, ...patch }));
      if (revision !== null) void save({ width, collapsed, ...patch }, revision);
    },
    [save, revision, width, collapsed],
  );
  const show = useCallback(
    (next: ColumnTab) => {
      setTab(next);
      if (collapsed) change({ collapsed: false });
    },
    [collapsed, change],
  );
  const setCollapsed = useCallback((next: boolean) => change({ collapsed: next }), [change]);
  const setWidth = useCallback((next: number) => change({ width: next }), [change]);
  return useMemo(
    () => ({ tab, width, collapsed, show, setCollapsed, setWidth }),
    [tab, width, collapsed, show, setCollapsed, setWidth],
  );
}
