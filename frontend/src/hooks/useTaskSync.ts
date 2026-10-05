import { useEffect, useState } from "react";
import { useTasksContext } from "../context/TasksContext";
import { listAllReminders, pushPendingOfflineTasks, tasksRuntime, type Task } from "../lib/tasks";
import { valueOr } from "../lib/loaded";
import type { AuthSession } from "../lib/auth";

// Retained as the reported delivery channel, and now actually true: the server
// sweeps for due reminders on its own timer and pushes over Web Push. It was
// "local" while the only dispatcher was the interval below, which sent nothing.
const deliveryProvider = "web_push" as const;

/**
 * A view over TasksContext, plus the two things that are genuinely Home's own.
 *
 * This hook used to own `tasks`, `isLoading`, `remindersByTask` and
 * `pendingReminders` as its own useState, while TasksContext owned a second copy
 * of all four. The two were polled independently and disagreed: the hook showed
 * sent and pending reminders unsliced, the context showed pending truncated to
 * five. Home rendered from this hook while every other tab rendered from the
 * context, so acknowledging a reminder updated the copy Home did not read and it
 * never cleared.
 *
 * Rather than patch the two copies into agreement, this hook stopped being a
 * second owner. It reads the shared state and keeps only what is local to Home:
 * the dispatch/offline notice, and the offline-sync poll, which nothing else
 * needs.
 */
export function useTaskSync(authSession: AuthSession | null, onError?: (m: string | null) => void) {
  const { tasks, setTasks, isLoading, remindersByTask, pendingReminders, setPendingReminders, refresh, refreshRemindersForTask } = useTasksContext();
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

  /**
   * Derived, not stored.
   *
   * This used to be state set inside `loadTasks`, which meant it could disagree
   * with the task list it was describing whenever the two were updated by
   * different paths. Computing it means the banner cannot go stale.
   */
  const dueNowCount = tasks.filter((task) => task.status === "due_now").length;
  const dueNotice =
    dueNowCount === 0 ? null : dueNowCount === 1 ? "1 task is due now." : `${dueNowCount} tasks are due now.`;

  /**
   * Read only. The server delivers due reminders on its own timer now, so this
   * must not dispatch: two dispatchers means the user gets the same reminder
   * twice. Its job is to keep the pending list matching what the server believes.
   */
  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      setPendingReminders([]);
      setDispatchNotice(null);
      return;
    }

    const refreshPending = async () => {
      const result = await listAllReminders("pending");
      // Only genuinely undelivered reminders. The old filter also matched "sent",
      // which put reminders the user had already received into a card titled
      // "waiting for delivery".
      if (result.kind === "failed") {
        // Keep the last known list. Clearing it would assert "you have nothing
        // waiting", which is a claim a failed request cannot support.
        return;
      }
      setPendingReminders(valueOr(result, []));
    };

    void refreshPending();
    const id = setInterval(() => void refreshPending(), 30_000);
    return () => clearInterval(id);
  }, [authSession, setPendingReminders]);

  /**
   * Offline create recovery.
   *
   * Home-only because the offline cache and the create form are Home's concern.
   * The failure is reported rather than swallowed: a silent `catch {}` here is
   * why a sync loop failing every 30 seconds produced no visible sign at all.
   */
  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    const push = async () => {
      try {
        const pushed = await pushPendingOfflineTasks();
        if (pushed > 0) {
          setDispatchNotice(`${pushed} offline task${pushed > 1 ? "s" : ""} synced to server`);
          void refresh();
        }
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
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
  }, [authSession, onError, refresh]);

  /** Swap one task in place, for a mutation that already knows the server state. */
  function replaceTask(nextTask: Task) {
    setTasks((currentTasks) => currentTasks.map((task) => (task.id === nextTask.id ? nextTask : task)));
  }

  function removeTask(id: string) {
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id));
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
    loadTasks: refresh,
    refreshRemindersForTask,
    replaceTask,
    removeTask,
  };
}