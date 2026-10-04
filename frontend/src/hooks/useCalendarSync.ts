import { useEffect, useState } from "react";
import { Linking } from "react-native";
import {
  getCalendarAuthorizationUrl,
  getCalendarStatus,
  syncCalendarEvents,
  tasksRuntime,
  describeTaskError,
} from "../lib/tasks";
import type { AuthSession } from "../lib/auth";

export function useCalendarSync(authSession: AuthSession | null, onError: (m: string | null) => void, onNotice: (m: string | null) => void) {
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      setCalendarStatus(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await getCalendarStatus();
        if (!cancelled) setCalendarStatus(s);
      } catch {
        if (!cancelled) setCalendarStatus("unknown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authSession]);

  async function handleConnectCalendar() {
    if (!tasksRuntime.isApiMode || authSession === null) {
      onError("Sign in before connecting Google Calendar.");
      return;
    }
    setIsConnecting(true);
    onError(null);
    try {
      // Come back to this screen so the status chip updates after consent.
      const returnTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const url = await getCalendarAuthorizationUrl(returnTo);
      // Linking covers web (new tab) and native (system browser) without adding
      // a dependency on expo-web-browser.
      await Linking.openURL(url);
      onNotice("Finish connecting in the Google window, then come back and refresh.");
    } catch (e: any) {
      onError(describeTaskError(e));
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSyncCalendar() {
    if (!tasksRuntime.isApiMode || calendarStatus !== "active") {
      onError("Connect Google Calendar first.");
      return;
    }
    setIsSyncing(true);
    onError(null);
    try {
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await syncCalendarEvents(timeMin, timeMax);
      onNotice(`Calendar synced — ${res.synced} events cached for 7 days`);
      const s = await getCalendarStatus();
      setCalendarStatus(s);
    } catch (e: any) {
      onError(describeTaskError(e));
    } finally {
      setIsSyncing(false);
    }
  }

  return { calendarStatus, setCalendarStatus, isSyncing, isConnecting, handleSyncCalendar, handleConnectCalendar };
}
