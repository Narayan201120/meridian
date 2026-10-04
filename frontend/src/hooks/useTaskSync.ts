import { useEffect, useState } from "react";
import {
  describeTaskError,
  listAllReminders,
  listReminders,
  listTasks,
  pushPendingOfflineTasks,
  tasksRuntime,
  type Reminder,
  type Task,
} from "../lib/tasks";
import type { AuthSession } from "../lib/auth";

// Retained as the reported delivery channel, and now actually true: the server
// sweeps for due reminders on its own timer and pushes over Web Push. It was
// "local" while the only dispatcher was the interval below, which sent nothing.
const deliveryProvider = "web_push" as const;

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

    // Read only. The server delivers due reminders on its own timer now, so
    // this must not dispatch: two dispatchers means the user gets the same
    // reminder twice. Its whole job is to keep the list matching what the
    // server believes, rather than guessing locally.
    const refreshPending = async () => {
      try {
        // Only genuinely undelivered reminders. The old filter also matched
        // "sent", which put reminders the user had already received into a card
        // titled "waiting for delivery".
        setPendingReminders(await listAllReminders("pending"));
      } catch {
        // Keep the last known list. Clearing it would assert "you have nothing
        // waiting", which is a claim a failed request cannot support.
      }
    };

    void refreshPending();
    const id = setInterval(() => void refreshPending(), 30_000);
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
    deliveryProvider,
    setDispatchNotice,
    setPendingReminders,
    loadTasks,
    refreshRemindersForTask,
    replaceTask,
  };
}
