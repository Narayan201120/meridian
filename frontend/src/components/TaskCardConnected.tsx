import TaskCardEditor from "./TaskCardEditor";
import { useTasksContext } from "../context/TasksContext";
import { useTaskMutations } from "../hooks/useTaskMutations";
import type { Task } from "../lib/tasks";

// Canonical card for tab screens: rich TaskCardEditor wired to shared context.
export default function TaskCardConnected({ task }: { task: Task }) {
  const { setTasks, setErrorMessage, calendarStatus, remindersByTask, refreshRemindersForTask } = useTasksContext();
  const m = useTaskMutations({
    replaceTask: (next) => setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t))),
    removeTask: (id) => setTasks((prev) => prev.filter((t) => t.id !== id)),
    refreshReminders: (id) => void refreshRemindersForTask(id),
    notify: setErrorMessage,
    calendarStatus,
    activeFilter: "all",
    onFilterChange: () => {},
  });

  // The three states stay distinct all the way to the card: `undefined` is a
  // read that has not happened (the card says so), `null` is a failed read
  // (the card says so), and `[]` is a successful read that found nothing (the
  // card may then promise a reminder). Defaulting the missing key to [] is what
  // rendered the promise while the first read was still in flight.
  const reminders = remindersByTask[task.id];

  return (
    <TaskCardEditor
      task={task}
      isBusy={m.activeTaskId === task.id}
      activeAction={m.activeTaskId === task.id ? m.activeTaskAction : null}
      isEditingSchedule={m.scheduleEditorTaskId === task.id}
      isEditingTask={m.taskEditorTaskId === task.id}
      scheduleEditorValue={m.scheduleEditorValue}
      taskEditorTitle={m.taskEditorTitle}
      taskEditorNotes={m.taskEditorNotes}
      taskEditorPriority={m.taskEditorPriority}
      taskEditorDuration={m.taskEditorDuration}
      suggestions={m.suggestionsByTask[task.id] ?? []}
      reminders={reminders}
      callbacks={{
        onOpenTaskEditor: () => m.handleOpenTaskEditor(task),
        onCloseTaskEditor: m.closeTaskEditor,
        onSaveTaskDetails: () => void m.handleSaveTaskDetails(task),
        onOpenScheduleEditor: () => m.handleOpenScheduleEditor(task),
        onCloseScheduleEditor: m.closeScheduleEditor,
        onSaveSchedule: () => void m.handleSaveSchedule(task),
        onUnschedule: () => void m.handleUnscheduleTask(task),
        onToggleStatus: () => void m.handleToggleTaskStatus(task),
        onDelete: () => void m.handleDeleteTask(task.id),
        onSuggest: () => void m.handleSuggestBlocks(task),
        onApplySuggestion: (block) => void m.handleApplySuggestion(task, block),
        setScheduleEditorValue: m.setScheduleEditorValue,
        setTaskEditorTitle: m.setTaskEditorTitle,
        setTaskEditorNotes: m.setTaskEditorNotes,
        setTaskEditorPriority: m.setTaskEditorPriority,
        setTaskEditorDuration: m.setTaskEditorDuration,
      }}
    />
  );
}
