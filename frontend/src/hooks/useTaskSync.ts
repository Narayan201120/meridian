import { useCallback, useEffect, useMemo, useState } from "react";
import { useTasksContext } from "../context/TasksContext";
import { listAllReminders, pushPendingOfflineTasks, tasksRuntime, type Task } from "../lib/tasks";
import { valueOr } from "../lib/loaded";
import type { AuthSession } from "../lib/auth";

const deliveryProvider = "web_push" as const;

export function useTaskSync(authSession: AuthSession | null, onError?: (m: string | null) => void) {
  const { tasks, setTasks, isLoading, remindersByTask, pendingReminders, setPendingReminders, refresh, refreshRemindersForTask } = useTasksContext();
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

  const dueNotice = useMemo(() => {
    let count = 0;
    for (const task of tasks) {
      if (task.status === "due_now") count += 1;
    }
    if (count === 0) return null;
    return count === 1 ? "1 task is due now." : `${count} tasks are due now.`;
  }, [tasks]);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      setPendingReminders([]);
      setDispatchNotice(null);
      return;
    }

    let cancelled = false;
    const refreshPending = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const result = await listAllReminders("pending");
      if (cancelled || result.kind === "failed") {
        return;
      }
      setPendingReminders(valueOr(result, []));
    };

    void refreshPending();
    const id = setInterval(() => void refreshPending(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authSession, setPendingReminders]);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    let cancelled = false;
    const push = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const pushed = await pushPendingOfflineTasks();
        if (cancelled) return;
        if (pushed > 0) {
          setDispatchNotice(`${pushed} offline task${pushed > 1 ? "s" : ""} synced to server`);
          void refresh();
        }
      } catch (error) {
        if (!cancelled) onError?.(error instanceof Error ? error.message : String(error));
      }
    };
    void push();
    const pid = setInterval(() => void push(), 60_000);
    const handleOnline = () => void push();
    if (typeof window !== "undefined") window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      clearInterval(pid);
      if (typeof window !== "undefined") window.removeEventListener("online", handleOnline);
    };
  }, [authSession, onError, refresh]);

  const replaceTask = useCallback((nextTask: Task) => {
    setTasks((currentTasks) => {
      let changed = false;
      const next = currentTasks.map((task) => {
        if (task.id !== nextTask.id) return task;
        changed = true;
        return nextTask;
      });
      return changed ? next : currentTasks;
    });
  }, [setTasks]);

  const removeTask = useCallback((id: string) => {
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id));
  }, [setTasks]);

  return useMemo(() => ({
    tasks,
    setTasks,
    isLoading,
    dueNotice,
    remindersByTask,
    pendingReminders,
    dispatchNotice,
    deliveryProvider,
    setDispatchNotice,
    setPendingReminders,
    loadTasks: refresh,
    refreshRemindersForTask,
    replaceTask,
    removeTask,
  }), [tasks, setTasks, isLoading, dueNotice, remindersByTask, pendingReminders, dispatchNotice, setDispatchNotice, setPendingReminders, refresh, refreshRemindersForTask, replaceTask, removeTask]);
}
