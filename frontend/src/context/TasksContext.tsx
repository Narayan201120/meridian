import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getCurrentSession, type AuthSession } from "../lib/auth";
import { listTasks, tasksRuntime, type Task } from "../lib/tasks";
import { listReminders, type Reminder } from "../lib/tasks";
import { getCalendarStatus } from "../lib/tasks";

type TasksContextValue = {
  tasks: Task[];
  authSession: AuthSession | null;
  setAuthSession: (s: AuthSession | null) => void;
  isLoading: boolean;
  errorMessage: string | null;
  setErrorMessage: (m: string | null) => void;
  calendarStatus: string | null;
  remindersByTask: Record<string, Reminder[]>;
  pendingReminders: Reminder[];
  refresh: () => Promise<void>;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getCurrentSession());
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
    try {
      const nextTasks = await listTasks();
      setTasks(nextTasks);
      void loadRemindersForTasks(nextTasks);
      // also refresh pending dispatch list
      if (tasksRuntime.isApiMode && authSession) {
        try {
          const { listAllReminders } = await import("../lib/tasks");
          const all = await listAllReminders("pending");
          setPendingReminders(all.slice(0, 5));
        } catch {}
      }
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsLoading(false);
    }
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

  return (
    <TasksContext.Provider value={{ tasks, authSession, setAuthSession, isLoading, errorMessage, setErrorMessage, calendarStatus, remindersByTask, pendingReminders, refresh }}>
      {children}
    </TasksContext.Provider>
  );
}

export function useTasksContext() {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasksContext must be used within TasksProvider");
  return ctx;
}
