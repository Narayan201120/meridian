import { Text, View } from "react-native";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { TaskDetailsEditor } from "./TaskDetailsEditor";
import { ScheduleEditor } from "./ScheduleEditor";
import { formatTaskTime } from "../lib/datetime";
import type { Reminder, SuggestedBlock, Task } from "../lib/tasks";

/**
 * Colour a reminder line by what actually happened to it.
 *
 * Every line here used to render in `text-successtext`, a dark green, including
 * reminders that had been failing to send forever and reminders the user had
 * cancelled. Green means delivered, and a reminder that never arrived looked
 * exactly like one that did. The status word was appended so it was technically
 * recoverable by reading closely, but the visual weight said "done".
 *
 * Canceled is muted rather than green: it is inert history, not an achievement.
 */
function reminderTone(status: string): string {
  switch (status) {
    case "sent":
      return "text-successtext";
    case "failed":
      return "text-redtext";
    case "canceled":
    case "acknowledged":
      return "text-sandmuted dark:text-nightmuted";
    default:
      // pending and scheduled have not happened yet, so success green would be
      // a claim about the future.
      return "text-bodytext dark:text-nightmuted";
  }
}

export interface TaskCardEditorCallbacks {
  onOpenTaskEditor: () => void;
  onCloseTaskEditor: () => void;
  onSaveTaskDetails: () => void | Promise<void>;
  onOpenScheduleEditor: () => void;
  onCloseScheduleEditor: () => void;
  onSaveSchedule: () => void | Promise<void>;
  onUnschedule: () => void | Promise<void>;
  onToggleStatus: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onSuggest: () => void | Promise<void>;
  onApplySuggestion: (block: SuggestedBlock) => void | Promise<void>;
  setScheduleEditorValue: (v: string) => void;
  setTaskEditorTitle: (v: string) => void;
  setTaskEditorNotes: (v: string) => void;
  setTaskEditorPriority: (v: Task["priority"]) => void;
  setTaskEditorDuration: (v: string) => void;
}

export interface TaskCardEditorProps {
  task: Task;
  isBusy: boolean;
  activeAction: string | null;
  isEditingSchedule: boolean;
  isEditingTask: boolean;
  scheduleEditorValue: string;
  taskEditorTitle: string;
  taskEditorNotes: string;
  taskEditorPriority: Task["priority"];
  taskEditorDuration: string;
  suggestions: SuggestedBlock[];
  reminders: Reminder[];
  callbacks: TaskCardEditorCallbacks;
}

export default function TaskCardEditor({
  task,
  isBusy,
  activeAction,
  isEditingSchedule,
  isEditingTask,
  scheduleEditorValue,
  taskEditorTitle,
  taskEditorNotes,
  taskEditorPriority,
  taskEditorDuration,
  suggestions,
  reminders,
  callbacks,
}: TaskCardEditorProps) {
  const isShowingSuggestions = suggestions.length > 0 || activeAction === "suggest";
  const busy = (action: string) => isBusy && activeAction === action;

  return (
    <Card variant="floating" className="p-4 md:p-4 gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-ink dark:text-nighttext text-[18px] leading-6 font-bold">{task.title}</Text>
        <Badge status={task.status} />
      </View>

      {isEditingTask ? (
        <TaskDetailsEditor
          title={taskEditorTitle}
          notes={taskEditorNotes}
          duration={taskEditorDuration}
          priority={taskEditorPriority}
          isBusy={isBusy}
          onTitle={callbacks.setTaskEditorTitle}
          onNotes={callbacks.setTaskEditorNotes}
          onDuration={callbacks.setTaskEditorDuration}
          onPriority={callbacks.setTaskEditorPriority}
          onSave={() => void callbacks.onSaveTaskDetails()}
          onCancel={callbacks.onCloseTaskEditor}
        />
      ) : task.notes ? (
        <Text className="text-[14px] leading-5 text-slate500">{task.notes}</Text>
      ) : null}

      <View className="flex-row justify-between gap-2">
          <Text className="text-[12px] font-semibold text-sandmuted dark:text-nightmuted">Priority: {task.priority}</Text>
        <Text className="text-[12px] font-semibold text-sandmuted dark:text-nightmuted">
          {task.estimated_duration_minutes ? `${task.estimated_duration_minutes} min` : "No estimate"}
        </Text>
      </View>

      {task.status === "scheduled" || task.status === "due_now" ? (
        <Text className="text-[13px] font-semibold text-ambertext">
          {task.status === "scheduled" ? "Scheduled for" : "Activated at"}: {formatTaskTime(task.due_at)}
        </Text>
      ) : null}

      {reminders.length > 0 ? (
        <View className="gap-1.5 mt-1">
          {reminders.map((r) => (
            <Text key={r.id} className={`text-[13px] font-semibold ${reminderTone(r.status)}`}>
              Remind {r.status === "canceled" ? "(canceled) " : ""}{r.type === "scheduled_block" ? "block" : "due"} at {formatTaskTime(r.scheduled_for)} · {r.status}
            </Text>
          ))}
        </View>
      ) : task.status === "scheduled" || task.status === "due_now" ? (
        <Text className="text-[12px] italic text-sandmuted dark:text-nightmuted mt-0.5">No reminder yet — will remind at scheduled time.</Text>
      ) : null}

      {isEditingSchedule ? (
        <ScheduleEditor
          value={scheduleEditorValue}
          isBusy={isBusy}
          onValue={callbacks.setScheduleEditorValue}
          onSave={() => void callbacks.onSaveSchedule()}
          onCancel={callbacks.onCloseScheduleEditor}
        />
      ) : null}

      <View className="flex-row flex-wrap gap-2 mt-1">
        <Button variant="primary" size="sm" loading={busy("complete") || busy("reopen")} onPress={() => void callbacks.onToggleStatus()} disabled={isBusy}>
          {task.status === "completed" ? "Reopen" : "Complete"}
        </Button>
        {task.status !== "completed" && !isEditingSchedule && !isEditingTask ? (
          <Button variant="secondary" size="sm" loading={busy("schedule")} onPress={callbacks.onOpenScheduleEditor} disabled={isBusy}>
            {task.status === "scheduled" ? "Reschedule" : task.status === "due_now" ? "Schedule again" : "Schedule"}
          </Button>
        ) : null}
        {(task.status === "scheduled" || task.status === "due_now") && !isEditingSchedule && !isEditingTask ? (
          <Button variant="ghost" size="sm" loading={busy("unschedule")} onPress={() => void callbacks.onUnschedule()} disabled={isBusy}>
            Move to inbox
          </Button>
        ) : null}
        {!isEditingTask && !isEditingSchedule ? (
          <Button variant="ghost" size="sm" onPress={callbacks.onOpenTaskEditor} disabled={isBusy}>
            Edit
          </Button>
        ) : null}
        {task.status !== "completed" && task.status !== "archived" ? (
          <Button variant="ghost" size="sm" loading={busy("suggest")} onPress={() => void callbacks.onSuggest()} disabled={isBusy}>
            {isShowingSuggestions ? "Hide suggestions" : "Suggest times"}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" textClassName="text-redtext" loading={busy("delete")} onPress={() => void callbacks.onDelete()} disabled={isBusy}>
          Delete
        </Button>
      </View>

      {isShowingSuggestions ? (
        <View className="gap-2.5 mt-1.5 pt-2.5 border-t border-borderfaint">
          {suggestions.length === 0 ? (
            <Text className="text-[13px] italic text-sandmuted dark:text-nightmuted">No suggestions loaded yet. Tap Suggest times again.</Text>
          ) : (
            suggestions.map((block) => (
              <View key={block.suggested_start_at} className="bg-sandbg dark:bg-nightcard rounded-2xl p-3 border border-sandborder dark:border-nightborder gap-1.5">
                <Text className="text-ink dark:text-nighttext text-[14px] font-bold">{formatTaskTime(block.suggested_start_at)}</Text>
                <Text className="text-bodytext dark:text-nightmuted text-[13px]">→ {formatTaskTime(block.suggested_end_at)}</Text>
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-amberbg self-start"
                  textClassName="text-ambertext"
                  loading={busy("schedule")}
                  onPress={() => void callbacks.onApplySuggestion(block)}
                  disabled={isBusy}
                >
                  Schedule here
                </Button>
              </View>
            ))
          )}
        </View>
      ) : null}
    </Card>
  );
}
