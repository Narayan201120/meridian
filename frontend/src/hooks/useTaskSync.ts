import { useEffect, useState } from "react";
import {
  describeTaskError,
  dispatchReminders,
  listAllReminders,
  listReminders,
  listTasks,
  pushPendingOfflineTasks,
  tasksRuntime,
  type Reminder,
  type Task,
} from "../lib/tasks";
import type { AuthSession } from "../lib/auth";

export function useTaskSync(authSession: AuthSession | null, onError?: (m: string | null) => void) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dueNotice, setDueNotice] = useState<string | null>(null);
  const [remindersByTask, setRemindersByTask] = useState<Record<string, Reminder[]>>({});
  const [pendingReminders, setPendingReminders] = useState<Reminder[]>([]);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

  async function loadRemindersForTasks(nextTasks: Task[]) {
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
        }),
      );
      const next: Record<string, Reminder[]> = {};
      for (const [id, rems] of entries) next[id] = rems;
      setRemindersByTask(next);
    } catch {
    }
  }

  async function refreshRemindersForTask(taskId: string) {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    try {
      const rems = await listReminders(taskId);
      setRemindersByTask((prev) => ({ ...prev, [taskId]: rems }));
    } catch {
    }
  }

  async function loadTasks({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) {
      setIsLoading(true);
      onError?.(null);
    }
    try {
      const nextTasks = await listTasks();
      const dueNowCount = nextTasks.filter((task) => task.status === "due_now").length;
      setDueNotice(
        dueNowCount > 0
          ? dueNowCount === 1
            ? "1 task is due now."
            : `${dueNowCount} tasks are due now.`
          : null,
      );
      setTasks(nextTasks);
      void loadRemindersForTasks(nextTasks);
    } catch (error) {
      if (!silent) {
        onError?.(describeTaskError(error));
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    if (tasksRuntime.isApiMode && authSession === null) {
      setTasks([]);
      setIsLoading(false);
      return;
    }
    void loadTasks();
  }, [authSession]);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      return;
    }
    const intervalId = setInterval(() => {
      void loadTasks({ silent: true });
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [authSession]);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      setPendingReminders([]);
      setDispatchNotice(null);
      return;
    }
    const dispatch = async () => {
      try {
        const res = await dispatchReminders();
        if (res.dispatched > 0) {
          setDispatchNotice(`${res.dispatched} reminder${res.dispatched > 1 ? "s" : ""} dispatched — marked sent`);
          const all = await listAllReminders();
          setPendingReminders(all.filter((r) => r.status === "sent" || r.status === "pending"));
          void loadTasks({ silent: true });
        } else {
          const all = await listAllReminders("pending");
          setPendingReminders(all.slice(0, 5));
        }
      } catch {
      }
    };
    void dispatch();
    const id = setInterval(() => void dispatch(), 30_000);
    return () => clearInterval(id);
  }, [authSession]);

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    const push = async () => {
      try {
        const pushed = await pushPendingOfflineTasks();
        if (pushed > 0) {
          setDispatchNotice(`${pushed} offline task${pushed > 1 ? "s" : ""} synced to server`);
          void loadTasks({ silent: true });
        }
      } catch {
      }
    };
    void push();
    const pid = setInterval(() => void push(), 30_000);
    const handleOnline = () => void push();
    if (typeof window !== "undefined") window.addEventListener("online", handleOnline);
    return () => {
      clearInterval(pid);
      if (typeof window !== "undefined") window.removeEventListener("online", handleOnline);
    };
  }, [authSession]);

  function replaceTask(nextTask: Task) {
    setTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === nextTask.id ? nextTask : task)),
    );
  }

  return {
    tasks,
    setTasks,
    isLoading,
    dueNotice,
    remindersByTask,
    pendingReminders,
    dispatchNotice,
    setDispatchNotice,
    setPendingReminders,
    loadTasks,
    refreshRemindersForTask,
    replaceTask,
  };
}
