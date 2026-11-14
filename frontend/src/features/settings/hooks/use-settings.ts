import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchSettings,
  fetchSystem,
  settingsKeys,
  updateSettings,
} from "../api/settings";

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
    retry: false,
    // Changed only on the Settings page, which updates this itself.
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateSettings,
    retry: false,
    onSuccess: (settings) => {
      client.setQueryData(settingsKeys.settings, settings);
    },
  });
}

export function useSystemQuery() {
  return useQuery({
    queryKey: settingsKeys.system,
    queryFn: ({ signal }) => fetchSystem(signal),
    retry: false,
  });
}

/**
 * The address other machines reach this app at, without a trailing slash:
 * the one saved in Settings, otherwise the address this page was opened
 * from. Used wherever a URL is shown for use outside the browser.
 */
export function usePublicOrigin(): string {
  const { data } = useSettingsQuery();
  return data?.publicUrl ?? window.location.origin;
}
