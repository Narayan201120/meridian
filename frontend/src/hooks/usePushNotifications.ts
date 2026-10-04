import { useCallback, useEffect, useState } from "react";
import { disablePush, enablePush, readPushState, type PushState } from "../lib/push";
import { useTasksContext } from "../context/TasksContext";
import { tasksRuntime } from "../lib/tasks";

/**
 * Web Push wiring for reminders.
 *
 * Browser permission can only be requested from a user gesture, so `enable` is
 * exposed as an action rather than fired from an effect. Status is read on
 * mount so the button can reflect reality instead of assuming.
 */
export function usePushNotifications() {
  const { authSession, refreshRemindersForTask } = useTasksContext();
  const [state, setState] = useState<PushState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      setState(null);
      return;
    }
    try {
      setState(await readPushState());
    } catch {
      setState({ supported: false, reason: "Could not read push status." });
    }
  }, [authSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A service worker only controls the page after it activates, and a first
  // visit has none registered yet.
  useEffect(() => {
    if (!isSupportedHere()) {
      return;
    }
    void navigator.serviceWorker
      .register("/service-worker.js")
      .catch(() => {
        // Non-fatal: the app works, the user just will not get background
        // reminders. readPushState reports unsupported if registration failed.
      });
  }, []);

  const enable = useCallback(async () => {
    setIsBusy(true);
    setMessage(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next.supported && "subscribed" in next && next.subscribed) {
        setMessage("Reminders will arrive even when this tab is closed.");
      } else if (next.supported && "permission" in next && next.permission === "denied") {
        setMessage("Your browser is blocking notifications for this site.");
      }
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setIsBusy(true);
    setMessage(null);
    try {
      await disablePush();
      await refresh();
      setMessage("Reminders will only appear while the app is open.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  // A reminder delivered by push should clear out of the pending list when the
  // user acts on it, so refresh whatever reminders are currently on screen.
  const acknowledge = useCallback(
    async (reminderId: string, taskId?: string | null) => {
      if (taskId) {
        await refreshRemindersForTask(taskId);
      }
      void reminderId;
      await refresh();
    },
    [refresh, refreshRemindersForTask],
  );

  return { state, isBusy, message, enable, disable, acknowledge, refresh };
}

function isSupportedHere(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}