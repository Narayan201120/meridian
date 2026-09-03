import { useEffect, useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PageShell } from "./src/components/ui/PageShell";
import { StatusBanner } from "./src/components/ui/StatusBanner";
import { CreateTaskForm } from "./src/components/CreateTaskForm";
import { VoiceCaptureCard } from "./src/components/VoiceCaptureCard";
import { TaskList } from "./src/components/TaskList";
import { Hero } from "./src/components/Hero";
import { ModeStatus } from "./src/components/ModeStatus";
import { AuthCard } from "./src/components/AuthCard";
import { PendingRemindersCard } from "./src/components/PendingRemindersCard";
import TaskCardEditor from "./src/components/TaskCardEditor";
import { useAuth } from "./src/hooks/useAuth";
import { useCalendarSync } from "./src/hooks/useCalendarSync";

import { authRuntime } from "./src/lib/auth";
import {
  confirmTaskCalendarBlock,
  createTaskCalendarBlock,
  deleteTask,
  dispatchReminders,
  listAllReminders,
  listReminders,
  pushPendingOfflineTasks,
  describeTaskError,
  listTasks,
  suggestBlocks,
  tasksRuntime,
  type Reminder,
  type SuggestedBlock,
  type Task,
  updateTask,
} from "./src/lib/tasks";

type TaskListFilter = "all" | Task["status"];

function formatDateTimeInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseDateTimeInputValue(value: string) {
  const normalized = value.trim().replace(" ", "T");

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Enter a valid schedule time in YYYY-MM-DDTHH:MM format.");
  }

  return parsed.toISOString();
}

function formatTaskTime(value: string | null) {
  if (!value) {
    return "No time set";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);
  const { authSession, authEmail, setAuthEmail, authPassword, setAuthPassword, isSigningIn, isSigningOut, handleSignIn, handleSignOut } = useAuth(setErrorMessage);
  const { calendarStatus, isSyncing, handleSyncCalendar } = useCalendarSync(authSession, setErrorMessage, setDispatchNotice);
  const [dueNotice, setDueNotice] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskFilter, setActiveTaskFilter] = useState<TaskListFilter>("all");
  const [scheduleEditorTaskId, setScheduleEditorTaskId] = useState<string | null>(null);
  const [scheduleEditorValue, setScheduleEditorValue] = useState("");
  const [taskEditorTaskId, setTaskEditorTaskId] = useState<string | null>(null);
  const [taskEditorTitle, setTaskEditorTitle] = useState("");
  const [taskEditorNotes, setTaskEditorNotes] = useState("");
  const [taskEditorPriority, setTaskEditorPriority] = useState<Task["priority"]>("medium");
  const [taskEditorDuration, setTaskEditorDuration] = useState("");
  const [activeTaskAction, setActiveTaskAction] = useState<
    "complete" | "reopen" | "delete" | "schedule" | "unschedule" | "edit" | "suggest" | null
  >(null);
  const [suggestTaskId, setSuggestTaskId] = useState<string | null>(null);
  const [suggestionsByTask, setSuggestionsByTask] = useState<Record<string, SuggestedBlock[]>>({});
  const [remindersByTask, setRemindersByTask] = useState<Record<string, Reminder[]>>({});
  const [pendingReminders, setPendingReminders] = useState<Reminder[]>([]);

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
      // ignore
    }
  }

  async function refreshRemindersForTask(taskId: string) {
    if (!tasksRuntime.isApiMode || authSession === null) return;
    try {
      const rems = await listReminders(taskId);
      setRemindersByTask((prev) => ({ ...prev, [taskId]: rems }));
    } catch {
      // ignore
    }
  }

  async function loadTasks({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) {
      setIsLoading(true);
      setErrorMessage(null);
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
        setErrorMessage(describeTaskError(error));
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
          // refresh reminders after dispatch
          const all = await listAllReminders();
          setPendingReminders(all.filter((r) => r.status === "sent" || r.status === "pending"));
          void loadTasks({ silent: true });
        } else {
          const all = await listAllReminders("pending");
          setPendingReminders(all.slice(0, 5));
        }
      } catch {
        // ignore
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
        // ignore
      }
    };
    void push();
    const pid = setInterval(() => void push(), 30_000);
    // also push when app comes back online
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



  async function handleSignOutAndClear() {
    await handleSignOut();
    setTasks([]);
  }

  async function handleToggleTaskStatus(task: Task) {
    const nextStatus = task.status === "completed" ? "inbox" : "completed";
    const nextAction = task.status === "completed" ? "reopen" : "complete";

    setActiveTaskId(task.id);
    setActiveTaskAction(nextAction);
    setErrorMessage(null);

    try {
      const nextTask = await updateTask(task.id, { status: nextStatus });
      replaceTask(nextTask);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleDeleteTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTaskAction("delete");
    setErrorMessage(null);

    try {
      await deleteTask(taskId);
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  function handleOpenTaskEditor(task: Task) {
    setTaskEditorTaskId(task.id);
    setTaskEditorTitle(task.title);
    setTaskEditorNotes(task.notes ?? "");
    setTaskEditorPriority(task.priority);
    setTaskEditorDuration(task.estimated_duration_minutes?.toString() ?? "");
    setErrorMessage(null);
  }

  function closeTaskEditor() {
    setTaskEditorTaskId(null);
    setTaskEditorTitle("");
    setTaskEditorNotes("");
    setTaskEditorPriority("medium");
    setTaskEditorDuration("");
  }

  async function handleSaveTaskDetails(task: Task) {
    const nextTitle = taskEditorTitle.trim();
    const durationInput = taskEditorDuration.trim();
    const estimatedDuration = durationInput ? Number(durationInput) : null;

    if (!nextTitle) {
      setErrorMessage("Give the task a title before saving it.");
      return;
    }

    if (
      estimatedDuration !== null &&
      (!Number.isInteger(estimatedDuration) || estimatedDuration <= 0 || estimatedDuration > 1_440)
    ) {
      setErrorMessage("Estimated duration must be a whole number between 1 and 1440 minutes.");
      return;
    }

    setActiveTaskId(task.id);
    setActiveTaskAction("edit");
    setErrorMessage(null);

    try {
      const nextTask = await updateTask(task.id, {
        title: nextTitle,
        notes: taskEditorNotes.trim() || null,
        priority: taskEditorPriority,
        estimated_duration_minutes: estimatedDuration,
      });
      replaceTask(nextTask);
      closeTaskEditor();
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  function handleOpenScheduleEditor(task: Task) {
    setScheduleEditorTaskId(task.id);
    setScheduleEditorValue(formatDateTimeInputValue(task.due_at));
    setErrorMessage(null);
  }

  async function handleSaveSchedule(task: Task) {
    let dueAt: string | null = null;

    try {
      dueAt = parseDateTimeInputValue(scheduleEditorValue);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
      return;
    }

    if (dueAt === null) {
      setErrorMessage("Pick a date and time before scheduling the task.");
      return;
    }

    setActiveTaskId(task.id);
    setActiveTaskAction("schedule");
    setErrorMessage(null);

    try {
      const nextTask = await updateTask(task.id, { status: "scheduled", due_at: dueAt });
      replaceTask(nextTask);
      if (activeTaskFilter !== "all" && activeTaskFilter !== nextTask.status) {
        setActiveTaskFilter(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      void refreshRemindersForTask(task.id);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleUnscheduleTask(task: Task) {
    setActiveTaskId(task.id);
    setActiveTaskAction("unschedule");
    setErrorMessage(null);

    try {
      const nextTask = await updateTask(task.id, { status: "inbox", due_at: null });
      replaceTask(nextTask);
      if (activeTaskFilter !== "all" && activeTaskFilter !== nextTask.status) {
        setActiveTaskFilter(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      void refreshRemindersForTask(task.id);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleSuggestBlocks(task: Task) {
    const isTogglingOff = suggestTaskId === task.id;
    if (isTogglingOff) {
      setSuggestTaskId(null);
      return;
    }

    setActiveTaskId(task.id);
    setActiveTaskAction("suggest");
    setErrorMessage(null);
    setSuggestTaskId(task.id);

    try {
      const result = await suggestBlocks(task.id, { max_results: 3 });
      setSuggestionsByTask((prev) => ({ ...prev, [task.id]: result.suggestions }));
      if (result.suggestions.length === 0) {
        setErrorMessage("No free calendar gaps found in the next 7 days for this duration.");
      }
    } catch (error) {
      setSuggestionsByTask((prev) => ({ ...prev, [task.id]: [] }));
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleApplySuggestion(task: Task, block: SuggestedBlock) {
    setActiveTaskId(task.id);
    setActiveTaskAction("schedule");
    setErrorMessage(null);

    try {
      // Try explicit calendar block path first (user-approved Google write) if calendar is connected
      if (tasksRuntime.isApiMode && calendarStatus === "active") {
        try {
          const created = await createTaskCalendarBlock(task.id, block);
          await confirmTaskCalendarBlock(task.id, created.id);
          // After confirm, backend already moved task to scheduled/due_now; refresh from server
          const refreshed = await listTasks();
          const updated = refreshed.find((t) => t.id === task.id);
          if (updated) replaceTask(updated);
          else {
            const nextTask = await updateTask(task.id, { status: "scheduled", due_at: block.suggested_start_at });
            replaceTask(nextTask);
          }
          if (activeTaskFilter !== "all" && updated && activeTaskFilter !== updated.status) {
            setActiveTaskFilter(updated.status);
          }
          setScheduleEditorTaskId(null);
          setScheduleEditorValue("");
          setSuggestTaskId(null);
          void refreshRemindersForTask(task.id);
          return;
        } catch (blockError) {
          // Fall back to direct schedule if block/confirm fails (e.g., not_connected)
          const msg = describeTaskError(blockError);
          if (!msg.toLowerCase().includes("calendar")) {
            throw blockError;
          }
          // else fall through to direct PATCH
        }
      }

      const nextTask = await updateTask(task.id, { status: "scheduled", due_at: block.suggested_start_at });
      replaceTask(nextTask);
      if (activeTaskFilter !== "all" && activeTaskFilter !== nextTask.status) {
        setActiveTaskFilter(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      setSuggestTaskId(null);
      void refreshRemindersForTask(task.id);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  function renderTaskCard(task: Task) {
    return (
      <TaskCardEditor
        key={task.id}
        task={task}
        isBusy={activeTaskId === task.id}
        activeAction={activeTaskId === task.id ? activeTaskAction : null}
        isEditingSchedule={scheduleEditorTaskId === task.id}
        isEditingTask={taskEditorTaskId === task.id}
        scheduleEditorValue={scheduleEditorValue}
        taskEditorTitle={taskEditorTitle}
        taskEditorNotes={taskEditorNotes}
        taskEditorPriority={taskEditorPriority}
        taskEditorDuration={taskEditorDuration}
        suggestions={suggestionsByTask[task.id] ?? []}
        reminders={remindersByTask[task.id] ?? []}
        callbacks={{
          onOpenTaskEditor: () => handleOpenTaskEditor(task),
          onCloseTaskEditor: closeTaskEditor,
          onSaveTaskDetails: () => void handleSaveTaskDetails(task),
          onOpenScheduleEditor: () => handleOpenScheduleEditor(task),
          onCloseScheduleEditor: () => { setScheduleEditorTaskId(null); setScheduleEditorValue(''); },
          onSaveSchedule: () => void handleSaveSchedule(task),
          onUnschedule: () => void handleUnscheduleTask(task),
          onToggleStatus: () => void handleToggleTaskStatus(task),
          onDelete: () => void handleDeleteTask(task.id),
          onSuggest: () => void handleSuggestBlocks(task),
          onApplySuggestion: (block) => void handleApplySuggestion(task, block),
          setScheduleEditorValue,
          setTaskEditorTitle,
          setTaskEditorNotes,
          setTaskEditorPriority,
          setTaskEditorDuration,
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <PageShell>
          <Hero />
          <ModeStatus
            authSession={authSession}
            calendarStatus={calendarStatus}
            isSyncing={isSyncing}
            isSigningOut={isSigningOut}
            onRefresh={() => void loadTasks()}
            onSync={() => void handleSyncCalendar()}
            onSignOut={() => void handleSignOutAndClear()}
          />

          {tasksRuntime.isApiMode && authSession === null ? (
            <AuthCard
              authEmail={authEmail}
              setAuthEmail={setAuthEmail}
              authPassword={authPassword}
              setAuthPassword={setAuthPassword}
              isSigningIn={isSigningIn}
              onSignIn={() => void handleSignIn()}
            />

          ) : (
            <>
              <CreateTaskForm />
              <VoiceCaptureCard />

              {errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} actionLabel="Retry" onAction={() => void loadTasks()} /> : null}

              {dueNotice ? <StatusBanner variant="success" title="Due now" message={dueNotice} /> : null}

              {dispatchNotice ? <StatusBanner variant="success" title="Reminders" message={dispatchNotice} /> : null}

              <PendingRemindersCard pending={pendingReminders} onAcked={(id) => setPendingReminders((prev) => prev.filter((x) => x.id !== id))} onError={(m) => setErrorMessage(m)} />

              <TaskList
                activeFilter={activeTaskFilter}
                setActiveFilter={setActiveTaskFilter}
                tasks={tasks}
                isLoading={isLoading}
                renderCard={renderTaskCard}
              />
            </>
          )}

          {tasksRuntime.isApiMode && authSession === null && errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} /> : null}
        </PageShell>
    </SafeAreaProvider>
  );
}
