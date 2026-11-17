import { useEffect, useRef, useState, type RefObject } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import type { IncidentsState } from "../../shared/contracts.js";
import { officeDeviceSettings } from "../../shared/settings.js";
import { newestFirst } from "../incidents-text.js";
import { markRung, toRing } from "./rung-incidents.js";
import type { WorldApi } from "./world-api.js";

/** When this device rang for each incident, epoch ms by incident id. */
type RungMap = Record<string, number>;

/** A save the device refused: the same map is not saved again against the same revision. */
interface RefusedSave {
  map: RungMap;
  revision: string;
}

export interface IncidentAlarmInput {
  world: RefObject<WorldApi | null>;
  /** The scene has started: `world` holds it. */
  started: boolean;
  /** The host's incidents; undefined until the host sends them, or from a host without them. */
  incidents: IncidentsState | undefined;
}

/**
 * Sends the open incidents to the 3D office, newest first, each ringing where this device has not
 * rung for it, and keeps what rang in the `office-device` setting. Nothing goes to the scene before
 * that setting is read, or opening the office again would ring again for what it rang for. The
 * setting is saved when something rang or an old entry dropped out, not on each snapshot.
 */
export function useIncidentAlarm({ world, started, incidents }: IncidentAlarmInput): void {
  const device = useSettings(officeDeviceSettings);
  const stored = device.status === "ready" ? device : null;
  const loaded = stored !== null;
  // The setting as last read, for the effect below without running it again on each read.
  const latest = useRef(stored);
  useEffect(() => {
    latest.current = stored;
  });
  // What this view rang for: the device's map once read, and each ring since.
  const rung = useRef<RungMap | null>(null);
  // The map to save, until the device holds it.
  const [unsaved, setUnsaved] = useState<RungMap | null>(null);

  useEffect(() => {
    const scene = world.current;
    const read = latest.current;
    if (!started || scene === null || read === null || incidents === undefined) return;
    const known = rung.current ?? read.values.rungIncidents;
    const open = newestFirst(incidents.open);
    const ringing = toRing(open, known);
    const list = open.map(({ id, key, title }) => ({ id, key, title, ring: ringing.includes(id) }));
    scene.setIncidents?.(list);
    const next = markRung(known, ringing, Date.now());
    rung.current = next;
    const dropped = Object.keys(next).length < Object.keys(known).length + ringing.length;
    if (ringing.length > 0 || dropped) setUnsaved(next);
  }, [world, started, loaded, incidents]);

  // A save refused because another save moved the revision first is tried again on the new one.
  const [saving, setSaving] = useState(false);
  const refused = useRef<RefusedSave | null>(null);
  const { save, reload } = device;
  useEffect(() => {
    if (unsaved === null || stored === null || saving) return;
    const { values, revision } = stored;
    if (refused.current?.map === unsaved && refused.current.revision === revision) return;
    setSaving(true);
    async function keep(map: RungMap): Promise<void> {
      if (await save({ ...values, rungIncidents: map }, revision)) {
        setUnsaved((current) => (current === map ? null : current));
      } else {
        refused.current = { map, revision };
        await reload().catch(() => undefined);
      }
      setSaving(false);
    }
    void keep(unsaved);
  }, [unsaved, stored, saving, save, reload]);
}
