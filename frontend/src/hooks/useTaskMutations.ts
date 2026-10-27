import { useCallback, useMemo, useState } from "react";

import { valueOr } from "../lib/loaded";
import {
  cancelTaskCalendarBlock,
  confirmTaskCalendarBlock,
  createTaskCalendarBlock,
  deleteTask,
  describeTaskError,
  listTaskCalendarBlocks,
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

  const handleToggleTaskStatus = useCallback(async (task: Task) => {
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
  }, [replaceTask, notify]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
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
  }, [removeTask, notify]);

  const handleOpenTaskEditor = useCallback((task: Task) => {
    setTaskEditorTaskId(task.id);
    setTaskEditorTitle(task.title);
    setTaskEditorNotes(task.notes ?? "");
    setTaskEditorPriority(task.priority);
    setTaskEditorDuration(task.estimated_duration_minutes?.toString() ?? "");
    notify(null);
  }, [notify]);

  const closeTaskEditor = useCallback(() => {
    setTaskEditorTaskId(null);
    setTaskEditorTitle("");
    setTaskEditorNotes("");
    setTaskEditorPriority("medium");
    setTaskEditorDuration("");
  }, []);

  const handleSaveTaskDetails = useCallback(async (task: Task) => {
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
  }, [taskEditorTitle, taskEditorDuration, taskEditorNotes, taskEditorPriority, replaceTask, notify, closeTaskEditor]);

  const handleOpenScheduleEditor = useCallback((task: Task) => {
    setScheduleEditorTaskId(task.id);
    setScheduleEditorValue(formatDateTimeInputValue(task.due_at));
    notify(null);
  }, [notify]);

  const closeScheduleEditor = useCallback(() => {
    setScheduleEditorTaskId(null);
    setScheduleEditorValue("");
  }, []);

  const handleSaveSchedule = useCallback(async (task: Task) => {
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
  }, [scheduleEditorValue, replaceTask, activeFilter, onFilterChange, refreshReminders, notify]);

  const cancelConfirmedBlocks = useCallback(async (task: Task) => {
    if (!tasksRuntime.isApiMode) {
      return;
    }
    const blocks = await listTaskCalendarBlocks(task.id);
    for (const block of blocks) {
      if (block.status !== "confirmed") {
        continue;
      }
      const result = await cancelTaskCalendarBlock(task.id, block.id);
      if (result.last_error_message) {
        throw new Error(result.last_error_message);
      }
    }
  }, []);

  const handleUnscheduleTask = useCallback(async (task: Task) => {
    setActiveTaskId(task.id);
    setActiveTaskAction("unschedule");
    notify(null);
    try {
      await cancelConfirmedBlocks(task);
      const nextTask = await updateTask(task.id, { status: "inbox", due_at: null });
      replaceTask(nextTask);
      if (activeFilter !== "all" && activeFilter !== nextTask.status) {
        onFilterChange(nextTask.status);
      }
      setScheduleEditorTaskId(null);
      setScheduleEditorValue("");
      setSuggestTaskId(null);
      setSuggestionsByTask((prev) => {
        const { [task.id]: _removed, ...rest } = prev;
        return rest;
      });
      refreshReminders(task.id);
    } catch (error) {
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }, [cancelConfirmedBlocks, replaceTask, activeFilter, onFilterChange, refreshReminders, notify]);

  const handleSuggestBlocks = useCallback(async (task: Task) => {
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
      const result = await suggestBlocks(task.id, {
        max_results: 3,
        duration_minutes: task.estimated_duration_minutes ?? undefined,
      });
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
  }, [suggestTaskId, notify]);

  const handleApplySuggestion = useCallback(async (task: Task, block: SuggestedBlock) => {
    setActiveTaskId(task.id);
    setActiveTaskAction("schedule");
    notify(null);
    let calendarWriteFailed = false;
    try {
      if (tasksRuntime.isApiMode && calendarStatus === "active") {
        try {
          const created = await createTaskCalendarBlock(task.id, block);
          await confirmTaskCalendarBlock(task.id, created.id);
        } catch {
          calendarWriteFailed = true;
        }
        if (!calendarWriteFailed) {
          const refreshed = await listTasks();
          const updated = valueOr(refreshed, []).find((t) => t.id === task.id);
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
      if (calendarWriteFailed) {
        notify("Scheduled in Meridian, but Google Calendar did not accept the event — it is not on your calendar.");
      }
      refreshReminders(task.id);
    } catch (error) {
      notify(describeTaskError(error));
    } finally {
      setActiveTaskId(null);
      setActiveTaskAction(null);
    }
  }, [calendarStatus, replaceTask, activeFilter, onFilterChange, refreshReminders, notify]);

  return useMemo(() => ({
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
  }), [
    activeTaskId, activeTaskAction, scheduleEditorTaskId, scheduleEditorValue,
    taskEditorTaskId, taskEditorTitle, taskEditorNotes, taskEditorPriority, taskEditorDuration,
    suggestTaskId, suggestionsByTask,
    handleToggleTaskStatus, handleDeleteTask, handleOpenTaskEditor, closeTaskEditor,
    handleSaveTaskDetails, handleOpenScheduleEditor, closeScheduleEditor, handleSaveSchedule,
    handleUnscheduleTask, handleSuggestBlocks, handleApplySuggestion,
  ]);
}
