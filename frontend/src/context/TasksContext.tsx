import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getCurrentSession, type AuthSession } from "../lib/auth";
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
  remindersByTask: Record<string, Reminder[]>;
  pendingReminders: Reminder[];
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
  const [remindersByTask, setRemindersByTask] = useState<Record<string, Reminder[]>>({});
  const [pendingReminders, setPendingReminders] = useState<Reminder[]>([]);

  const loadRemindersForTasks = useCallback(async (nextTasks: Task[]) => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    const scheduled = nextTasks.filter((t) => t.status === "scheduled" || t.status === "due_now");
    if (scheduled.length === 0) {
      setRemindersByTask({});
      return;
    }
    try {
      const entries = await Promise.all(
        scheduled.map(async (t) => {
          try {
            const rems = await listReminders(t.id);
            return [t.id, rems] as const;
          } catch {
            return [t.id, [] as Reminder[]] as const;
          }
        })
      );
      const next: Record<string, Reminder[]> = {};
      for (const [id, rems] of entries) next[id] = rems;
      setRemindersByTask(next);
    } catch {
      // ignore
    }
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
      // ignore
    }
  }, [authSession]);

  return (
    <TasksContext.Provider value={{ tasks, authSession, setAuthSession, isLoading, errorMessage, setErrorMessage, isStale, calendarStatus, remindersByTask, pendingReminders, refresh, setTasks, refreshRemindersForTask }}>
      {children}
    </TasksContext.Provider>
  );
}

export function useTasksContext() {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasksContext must be used within TasksProvider");
  return ctx;
}
