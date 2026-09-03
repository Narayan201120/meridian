import { useEffect, useState } from "react";
import { getCalendarStatus, syncCalendarEvents, tasksRuntime, describeTaskError } from "../lib/tasks";
import type { AuthSession } from "../lib/auth";

export function useCalendarSync(authSession: AuthSession | null, onError: (m: string | null) => void, onNotice: (m: string | null) => void) {
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

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

  return { calendarStatus, setCalendarStatus, isSyncing, handleSyncCalendar };
}
