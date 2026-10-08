import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getCurrentSession, onSessionLost, type AuthSession } from "../lib/auth";
import { listAllReminders, listTasks, tasksRuntime, type Task } from "../lib/tasks";
import { listReminders, type Reminder } from "../lib/tasks";
import { getCalendarStatus } from "../lib/tasks";
import { failureMessage, valueOr } from "../lib/loaded";

type TasksContextValue = {
  tasks: Task[];
  authSession: AuthSession | null;
  setAuthSession: (s: AuthSession | null) => void;
  isLoading: boolean;
  errorMessage: string | null;
  setErrorMessage: (m: string | null) => void;
  /** True when `tasks` holds cached data because the most recent read failed. */
  isStale: boolean;
  calendarStatus: string | null;
  remindersByTask: Record<string, Reminder[] | null>;
  pendingReminders: Reminder[];
  /**
   * Exposed so an optimistic ack can drop a row the server has already settled.
   * Without it the only way to acknowledge is to refetch, which makes the row
   * jump back if the request failed.
   */
  setPendingReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  refresh: () => Promise<void>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  refreshRemindersForTask: (taskId: string) => Promise<void>;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getCurrentSession());
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** True when `tasks` is showing cached data because the last read failed. */
  const [isStale, setIsStale] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [remindersByTask, setRemindersByTask] = useState<Record<string, Reminder[] | null>>({});
  const [pendingReminders, setPendingReminders] = useState<Reminder[]>([]);

  const loadRemindersForTasks = useCallback(async (nextTasks: Task[]) => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    const scheduled = nextTasks.filter((t) => t.status === "scheduled" || t.status === "due_now");
    if (scheduled.length === 0) {
      setRemindersByTask({});
      return;
    }
    // A failed read is stored as null, never as []. An empty array means "the
    // server answered and this task has no reminders", which is the only basis
    // for the card's "will remind at scheduled time" line. Storing [] on
    // failure is what let a 500 render as a delivery promise.
    //
    // There is no outer try/catch here on purpose. Each per-task read catches
    // its own failure, so Promise.all cannot reject and an outer catch would
    // be dead code that suggests a failure path that no longer exists.
    const entries = await Promise.all(
      scheduled.map(async (t) => {
        try {
          const rems = await listReminders(t.id);
          return [t.id, rems] as const;
        } catch {
          return [t.id, null] as const;
        }
      })
    );
    const next: Record<string, Reminder[] | null> = {};
    for (const [id, rems] of entries) next[id] = rems;
    setRemindersByTask(next);
  }, [authSession]);

  const refresh = useCallback(async () => {
    if (tasksRuntime.isApiMode && authSession === null) {
      setTasks([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);

    const result = await listTasks();

    // Match on the union rather than catching an exception. A failure here
    // leaves the previous list alone and says why, which is the whole point:
    // setting tasks to [] on failure is what made a 500 render as "Inbox is
    // clear", a confident statement the server never made.
    if (result.kind === "failed") {
      setErrorMessage(failureMessage(result) ?? "Could not load tasks.");
      if (result.stale) {
        // Real data is being shown, just old. Label it rather than pretend.
        setIsStale(true);
      }
    } else {
      setTasks(valueOr(result, []));
      setIsStale(false);
      void loadRemindersForTasks(valueOr(result, []));
    }

    if (tasksRuntime.isApiMode && authSession) {
      const reminders = await listAllReminders("pending");
      if (reminders.kind === "failed") {
        // Leave the last known list. Clearing it here asserts "you have nothing
        // waiting", which is not something a failed request can support.
        if (reminders.authExpired) setErrorMessage(failureMessage(reminders));
      } else {
        setPendingReminders(valueOr(reminders, []));
      }
    }

    setIsLoading(false);
  }, [authSession, loadRemindersForTasks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * A dead session has to become a signed-out UI, not just failed requests.
   *
   * `apiFetch` can tell the difference between "refresh worked" and "this
   * session is finished", but it is a plain module function and cannot set state
   * here. Without this subscription the header keeps rendering "Signed in as
   * ..." against a token the server has already rejected, which is the original
   * defect rather than a fix for it.
   *
   * Tasks and reminders are cleared on the way out. Leaving them would put a
   * previous user's rows on screen for whoever signs in next.
   */
  useEffect(() => {
    return onSessionLost(() => {
      setAuthSession(null);
      setTasks([]);
      setPendingReminders([]);
      setRemindersByTask({});
      setIsStale(false);
      setCalendarStatus(null);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [authSession, refresh]);

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

  const refreshRemindersForTask = useCallback(async (taskId: string) => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    try {
      const rems = await listReminders(taskId);
      setRemindersByTask((prev) => ({ ...prev, [taskId]: rems }));
    } catch {
      // Mark the read as failed rather than keeping the previous value. The
      // previous value describes an earlier successful read, and rendering it
      // after a failed refresh presents stale data as current.
      setRemindersByTask((prev) => ({ ...prev, [taskId]: null }));
    }
  }, [authSession]);

  return (
    <TasksContext.Provider value={{ tasks, authSession, setAuthSession, isLoading, errorMessage, setErrorMessage, isStale, calendarStatus, remindersByTask, pendingReminders, setPendingReminders, refresh, setTasks, refreshRemindersForTask }}>
      {children}
    </TasksContext.Provider>
  );
}

export function useTasksContext() {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasksContext must be used within TasksProvider");
  return ctx;
}
