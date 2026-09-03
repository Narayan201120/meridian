import { useState } from "react";
import {
  confirmTaskCalendarBlock,
  createTaskCalendarBlock,
  deleteTask,
  describeTaskError,
  listTasks,
  suggestBlocks,
  tasksRuntime,
  updateTask,
  type SuggestedBlock,
  type Task,
} from "../lib/tasks";

export type TaskAction = "complete" | "reopen" | "delete" | "schedule" | "unschedule" | "edit" | "suggest" | null;

export type UseTaskMutationsDeps = {
  replaceTask: (task: Task) => void;
  removeTask?: (taskId: string) => void;
  refreshReminders: (id: string) => void;
  notify: (m: string | null) => void;
  calendarStatus: string | null;
  activeFilter: string;
  onFilterChange: (s: any) => void;
};

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

export function useTaskMutations(deps: UseTaskMutationsDeps) {
  const { replaceTask, removeTask, refreshReminders, notify, calendarStatus, activeFilter, onFilterChange } = deps;
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskAction, setActiveTaskAction] = useState<TaskAction>(null);
  const [scheduleEditorTaskId, setScheduleEditorTaskId] = useState<string | null>(null);
  const [scheduleEditorValue, setScheduleEditorValue] = useState("");
  const [taskEditorTaskId, setTaskEditorTaskId] = useState<string | null>(null);
  const [taskEditorTitle, setTaskEditorTitle] = useState("");
  const [taskEditorNotes, setTaskEditorNotes] = useState("");
  const [taskEditorPriority, setTaskEditorPriority] = useState<Task["priority"]>("medium");
  const [taskEditorDuration, setTaskEditorDuration] = useState("");
  const [suggestTaskId, setSuggestTaskId] = useState<string | null>(null);
  const [suggestionsByTask, setSuggestionsByTask] = useState<Record<string, SuggestedBlock[]>>({});

  async function handleToggleTaskStatus(task: Task) {
    const nextStatus = task.status === "completed" ? "inbox" : "completed";
    const nextAction = task.status === "completed" ? "reopen" : "complete";
    setActiveTaskId(task.id);
    setActiveTaskAction(nextAction);
    notify(null);
    try {
      const nextTask = await updateTask(task.id, { status: nextStatus });
      replaceTask(nextTask);
    } catch (error) {
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleDeleteTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTaskAction("delete");
    notify(null);
    try {
      await deleteTask(taskId);
      removeTask?.(taskId);
    } catch (error) {
      notify(describeTaskError(error));
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
    notify(null);
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
      notify("Give the task a title before saving it.");
      return;
    }
    if (
      estimatedDuration !== null &&
      (!Number.isInteger(estimatedDuration) || estimatedDuration <= 0 || estimatedDuration > 1_440)
    ) {
      notify("Estimated duration must be a whole number between 1 and 1440 minutes.");
      return;
    }
    setActiveTaskId(task.id);
    setActiveTaskAction("edit");
    notify(null);
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
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  function handleOpenScheduleEditor(task: Task) {
    setScheduleEditorTaskId(task.id);
    setScheduleEditorValue(formatDateTimeInputValue(task.due_at));
    notify(null);
  }

  function closeScheduleEditor() {
    setScheduleEditorTaskId(null);
    setScheduleEditorValue("");
  }

  async function handleSaveSchedule(task: Task) {
    let dueAt: string | null = null;
    try {
      dueAt = parseDateTimeInputValue(scheduleEditorValue);
    } catch (error) {
      notify(describeTaskError(error));
      return;
    }
    if (dueAt === null) {
      notify("Pick a date and time before scheduling the task.");
      return;
    }
    setActiveTaskId(task.id);
    setActiveTaskAction("schedule");
    notify(null);
    try {
      const nextTask = await updateTask(task.id, { status: "scheduled", due_at: dueAt });
      replaceTask(nextTask);
      if (activeFilter !== "all" && activeFilter !== nextTask.status) {
        onFilterChange(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      refreshReminders(task.id);
    } catch (error) {
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleUnscheduleTask(task: Task) {
    setActiveTaskId(task.id);
    setActiveTaskAction("unschedule");
    notify(null);
    try {
      const nextTask = await updateTask(task.id, { status: "inbox", due_at: null });
      replaceTask(nextTask);
      if (activeFilter !== "all" && activeFilter !== nextTask.status) {
        onFilterChange(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      refreshReminders(task.id);
    } catch (error) {
      notify(describeTaskError(error));
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
    notify(null);
    setSuggestTaskId(task.id);
    try {
      const result = await suggestBlocks(task.id, { max_results: 3 });
      setSuggestionsByTask((prev) => ({ ...prev, [task.id]: result.suggestions }));
      if (result.suggestions.length === 0) {
        notify("No free calendar gaps found in the next 7 days for this duration.");
      }
    } catch (error) {
      setSuggestionsByTask((prev) => ({ ...prev, [task.id]: [] }));
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  async function handleApplySuggestion(task: Task, block: SuggestedBlock) {
    setActiveTaskId(task.id);
    setActiveTaskAction("schedule");
    notify(null);
    try {
      if (tasksRuntime.isApiMode && calendarStatus === "active") {
        try {
          const created = await createTaskCalendarBlock(task.id, block);
          await confirmTaskCalendarBlock(task.id, created.id);
          const refreshed = await listTasks();
          const updated = refreshed.find((t) => t.id === task.id);
          if (updated) replaceTask(updated);
          else {
            const nextTask = await updateTask(task.id, { status: "scheduled", due_at: block.suggested_start_at });
            replaceTask(nextTask);
          }
          if (activeFilter !== "all" && updated && activeFilter !== updated.status) {
            onFilterChange(updated.status);
          }
          setScheduleEditorTaskId(null);
          setScheduleEditorValue("");
          setSuggestTaskId(null);
          refreshReminders(task.id);
          return;
        } catch (blockError) {
          const msg = describeTaskError(blockError);
          if (!msg.toLowerCase().includes("calendar")) {
            throw blockError;
          }
        }
      }
      const nextTask = await updateTask(task.id, { status: "scheduled", due_at: block.suggested_start_at });
      replaceTask(nextTask);
      if (activeFilter !== "all" && activeFilter !== nextTask.status) {
        onFilterChange(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      setSuggestTaskId(null);
      refreshReminders(task.id);
    } catch (error) {
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }

  return {
    activeTaskId,
    activeTaskAction,
    scheduleEditorTaskId,
    scheduleEditorValue,
    setScheduleEditorTaskId,
    setScheduleEditorValue,
    taskEditorTaskId,
    taskEditorTitle,
    taskEditorNotes,
    taskEditorPriority,
    taskEditorDuration,
    setTaskEditorTitle,
    setTaskEditorNotes,
    setTaskEditorPriority,
    setTaskEditorDuration,
    suggestTaskId,
    suggestionsByTask,
    setSuggestionsByTask,
    handleToggleTaskStatus,
    handleDeleteTask,
    handleOpenTaskEditor,
    closeTaskEditor,
    handleSaveTaskDetails,
    handleOpenScheduleEditor,
    closeScheduleEditor,
    handleSaveSchedule,
    handleUnscheduleTask,
    handleSuggestBlocks,
    handleApplySuggestion,
  };
}
