import { useEffect, useMemo, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  INITIAL_PROFILE_STATE,
  createProfileManager,
  type ProfileApi,
  type ProfileManager,
  type ProfileManagerState,
} from "./profile-manager";

/**
 * One open sheet's profile manager. It is made when the sheet mounts and loads the list at once;
 * a sheet that opens again starts from the host's list, never from what the last one showed.
 * `manager` is null until the first effect ran.
 */
export function useProfileManager(input: { client: DaemonClient; workspaceId: string }): {
  state: ProfileManagerState;
  manager: ProfileManager | null;
} {
  const { client, workspaceId } = input;
  const api = useMemo<ProfileApi>(
    () => ({
      list: () => client.listCdpBrowserProfiles(workspaceId),
      create: (name) => client.createCdpBrowserProfile(name),
      remove: (profileId) => client.deleteCdpBrowserProfile(profileId),
      assign: (profileId) => client.assignCdpBrowserProfile(workspaceId, profileId),
      importCookies: (profileId, source) => client.importCdpBrowserCookies(profileId, source),
    }),
    [client, workspaceId],
  );
  const [state, setState] = useState<ProfileManagerState>(INITIAL_PROFILE_STATE);
  const [manager, setManager] = useState<ProfileManager | null>(null);
  // Made in the effect, so each mount has its own: a stopped manager publishes nothing more.
  useEffect(() => {
    const made = createProfileManager({ api, onState: setState });
    setState(made.getState());
    setManager(made);
    void made.load();
    return () => made.stop();
  }, [api]);
  return { state, manager };
}
