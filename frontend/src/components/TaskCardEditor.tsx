// Canonical task card: TaskCardEditor is the rich editor (edit details,
// schedule/reschedule/unschedule, suggest/apply with calendar-block support).
// Prefer it for all task rendering. TaskCard (simple) is legacy for the
// filtered tabs only — do not extend it; migrate those tabs to this editor.
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Reminder, SuggestedBlock, Task } from "../lib/tasks";

function formatTaskTime(value: string | null) {
  if (!value) return "No time set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
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
  return (
    <View key={task.id} style={styles.taskCard}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <View
          style={[
            styles.badge,
            task.status === "completed"
              ? styles.completedBadge
              : task.status === "scheduled"
                ? styles.scheduledBadge
                : task.status === "due_now"
                  ? styles.dueNowBadge
                  : null,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              task.status === "completed"
                ? styles.completedBadgeText
                : task.status === "scheduled"
                  ? styles.scheduledBadgeText
                  : task.status === "due_now"
                    ? styles.dueNowBadgeText
                    : null,
            ]}
          >
            {task.status}
          </Text>
        </View>
      </View>
      {isEditingTask ? (
        <View style={styles.scheduleEditor}>
          <Text style={styles.scheduleEditorLabel}>Task details</Text>
          <TextInput
            placeholder="Task title"
            placeholderTextColor="#7D7A70"
            style={styles.input}
            value={taskEditorTitle}
            onChangeText={callbacks.setTaskEditorTitle}
          />
          <TextInput
            placeholder="Notes (optional)"
            placeholderTextColor="#7D7A70"
            style={[styles.input, styles.notesInput]}
            value={taskEditorNotes}
            onChangeText={callbacks.setTaskEditorNotes}
            multiline
          />
          <TextInput
            placeholder="Estimated duration in minutes (optional)"
            placeholderTextColor="#7D7A70"
            style={styles.input}
            value={taskEditorDuration}
            onChangeText={callbacks.setTaskEditorDuration}
            keyboardType="number-pad"
          />
          <View style={styles.filterRow}>
            {(["low", "medium", "high"] as const).map((priority) => {
              const isSelected = taskEditorPriority === priority;
              return (
                <Pressable
                  key={priority}
                  style={[styles.filterChip, isSelected ? styles.filterChipActive : null]}
                  onPress={() => callbacks.setTaskEditorPriority(priority)}
                >
                  <Text style={[styles.filterChipText, isSelected ? styles.filterChipTextActive : null]}>
                    {priority}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.taskActionsRow}>
            <Pressable
              style={[styles.taskActionButton, isBusy ? styles.buttonDisabled : null]}
              onPress={() => void callbacks.onSaveTaskDetails()}
              disabled={isBusy}
            >
              <Text style={styles.taskActionButtonText}>
                {isBusy && activeAction === "edit" ? "Saving..." : "Save details"}
              </Text>
            </Pressable>
            <Pressable style={[styles.taskActionButton, styles.secondaryTaskButton]} onPress={callbacks.onCloseTaskEditor}>
              <Text style={[styles.taskActionButtonText, styles.secondaryTaskButtonText]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : task.notes ? (
        <Text style={styles.taskNotes}>{task.notes}</Text>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Priority: {task.priority}</Text>
        <Text style={styles.metaText}>
          {task.estimated_duration_minutes
            ? `${task.estimated_duration_minutes} min`
            : "No estimate"}
        </Text>
      </View>
      {task.status === "scheduled" || task.status === "due_now" ? (
        <Text style={styles.scheduleMetaText}>
          {task.status === "scheduled" ? "Scheduled for" : "Activated at"}:{" "}
          {formatTaskTime(task.due_at)}
        </Text>
      ) : null}
      {reminders.length > 0 ? (
        <View style={styles.reminderList}>
          {reminders.map((r) => (
            <Text key={r.id} style={styles.reminderText}>
              Remind {r.status === "canceled" ? "(canceled) " : ""}{r.type === "scheduled_block" ? "block" : "due"} at {formatTaskTime(r.scheduled_for)} · {r.status}
            </Text>
          ))}
        </View>
      ) : task.status === "scheduled" || task.status === "due_now" ? (
        <Text style={styles.reminderEmpty}>No reminder yet — will remind at scheduled time.</Text>
      ) : null}
      {isEditingSchedule ? (
        <View style={styles.scheduleEditor}>
          <Text style={styles.scheduleEditorLabel}>Schedule time</Text>
          <TextInput
            placeholder="YYYY-MM-DDTHH:MM"
            placeholderTextColor="#7D7A70"
            style={styles.input}
            value={scheduleEditorValue}
            onChangeText={callbacks.setScheduleEditorValue}
            autoCapitalize="none"
          />
          <TextInput
            placeholder="Estimated duration in minutes (optional)"
            placeholderTextColor="#7D7A70"
            style={styles.input}
            value={taskEditorDuration}
            onChangeText={callbacks.setTaskEditorDuration}
            keyboardType="number-pad"
          />
          <View style={styles.filterRow}>
            {(["low", "medium", "high"] as const).map((priority) => {
              const isSelected = taskEditorPriority === priority;
              return (
                <Pressable
                  key={priority}
                  style={[styles.filterChip, isSelected ? styles.filterChipActive : null]}
                  onPress={() => callbacks.setTaskEditorPriority(priority)}
                >
                  <Text style={[styles.filterChipText, isSelected ? styles.filterChipTextActive : null]}>
                    {priority}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.taskActionsRow}>
            <Pressable
              style={[
                styles.taskActionButton,
                styles.scheduleButton,
                isBusy ? styles.buttonDisabled : null,
              ]}
              onPress={() => void callbacks.onSaveSchedule()}
              disabled={isBusy}
            >
              <Text style={[styles.taskActionButtonText, styles.scheduleButtonText]}>
                {isBusy && activeAction === "schedule" ? "Saving..." : "Save schedule"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.taskActionButton, styles.secondaryTaskButton]}
              onPress={callbacks.onCloseScheduleEditor}
            >
              <Text style={[styles.taskActionButtonText, styles.secondaryTaskButtonText]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={styles.taskActionsRow}>
        {!isEditingTask && !isEditingSchedule ? (
          <Pressable
            style={[styles.taskActionButton, styles.secondaryTaskButton, isBusy ? styles.buttonDisabled : null]}
            onPress={callbacks.onOpenTaskEditor}
            disabled={isBusy}
          >
            <Text style={[styles.taskActionButtonText, styles.secondaryTaskButtonText]}>Edit</Text>
          </Pressable>
        ) : null}
        {task.status !== "completed" && !isEditingSchedule && !isEditingTask ? (
          <Pressable
            style={[
              styles.taskActionButton,
              styles.scheduleButton,
              isBusy ? styles.buttonDisabled : null,
            ]}
            onPress={callbacks.onOpenScheduleEditor}
            disabled={isBusy}
          >
            <Text style={[styles.taskActionButtonText, styles.scheduleButtonText]}>
              {task.status === "scheduled" ? "Reschedule" : task.status === "due_now" ? "Schedule again" : "Schedule"}
            </Text>
          </Pressable>
        ) : null}
        {(task.status === "scheduled" || task.status === "due_now") && !isEditingSchedule && !isEditingTask ? (
          <Pressable
            style={[
              styles.taskActionButton,
              styles.secondaryTaskButton,
              isBusy ? styles.buttonDisabled : null,
            ]}
            onPress={() => void callbacks.onUnschedule()}
            disabled={isBusy}
          >
            <Text style={[styles.taskActionButtonText, styles.secondaryTaskButtonText]}>
              {isBusy && activeAction === "unschedule" ? "Moving..." : "Move to inbox"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.taskActionButton, isBusy ? styles.buttonDisabled : null]}
          onPress={() => void callbacks.onToggleStatus()}
          disabled={isBusy}
        >
          <Text style={styles.taskActionButtonText}>
            {isBusy && activeAction === "complete"
              ? "Completing..."
              : isBusy && activeAction === "reopen"
                ? "Reopening..."
                : task.status === "completed"
                  ? "Reopen"
                  : "Complete"}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.taskActionButton,
            styles.deleteButton,
            isBusy ? styles.buttonDisabled : null,
          ]}
          onPress={() => void callbacks.onDelete()}
          disabled={isBusy}
        >
          <Text style={[styles.taskActionButtonText, styles.deleteButtonText]}>
            {isBusy && activeAction === "delete" ? "Deleting..." : "Delete"}
          </Text>
        </Pressable>
      </View>
      {task.status !== "completed" && task.status !== "archived" ? (
        <View style={styles.suggestRow}>
          <Pressable
            style={[
              styles.taskActionButton,
              styles.suggestButton,
              isBusy ? styles.buttonDisabled : null,
            ]}
            onPress={() => void callbacks.onSuggest()}
            disabled={isBusy}
          >
            <Text style={[styles.taskActionButtonText, styles.suggestButtonText]}>
              {isBusy && activeAction === "suggest"
                ? "Finding..."
                : isShowingSuggestions
                  ? "Hide suggestions"
                  : "Suggest times"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {isShowingSuggestions ? (
        <View style={styles.suggestionList}>
          {suggestions.length === 0 ? (
            <Text style={styles.suggestionEmpty}>No suggestions loaded yet. Tap Suggest times again.</Text>
          ) : (
            suggestions.map((block) => (
              <View key={block.suggested_start_at} style={styles.suggestionCard}>
                <Text style={styles.suggestionTime}>{formatTaskTime(block.suggested_start_at)}</Text>
                <Text style={styles.suggestionTimeSmall}>→ {formatTaskTime(block.suggested_end_at)}</Text>
                <Pressable
                  style={[styles.taskActionButton, styles.scheduleButton, isBusy ? styles.buttonDisabled : null]}
                  onPress={() => void callbacks.onApplySuggestion(block)}
                  disabled={isBusy}
                >
                  <Text style={[styles.taskActionButtonText, styles.scheduleButtonText]}>
                    {isBusy && activeAction === "schedule" ? "Scheduling..." : "Schedule here"}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: "#FFFDF8",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DDCFB7",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1D2A2C",
  },
  notesInput: {
    minHeight: 108,
    textAlignVertical: "top",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#F5EADB",
    borderWidth: 1,
    borderColor: "#E0D0B5",
  },
  filterChipActive: {
    backgroundColor: "#132A24",
    borderColor: "#132A24",
  },
  filterChipText: {
    color: "#26413C",
    fontSize: 13,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#FFF8EE",
  },
  taskCard: {
    borderRadius: 18,
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "#E4D5BD",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  taskTitle: {
    flex: 1,
    color: "#152325",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  badge: {
    borderRadius: 999,
    backgroundColor: "#E4F0E7",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  completedBadge: {
    backgroundColor: "#D7E1EF",
  },
  scheduledBadge: {
    backgroundColor: "#F3E2B8",
  },
  dueNowBadge: {
    backgroundColor: "#F7D9BD",
  },
  badgeText: {
    color: "#204636",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  completedBadgeText: {
    color: "#324F75",
  },
  scheduledBadgeText: {
    color: "#7B5D17",
  },
  dueNowBadgeText: {
    color: "#8A4A16",
  },
  taskNotes: {
    color: "#5C6462",
    fontSize: 14,
    lineHeight: 20,
  },
  scheduleMetaText: {
    color: "#705A20",
    fontSize: 13,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  metaText: {
    color: "#6A6258",
    fontSize: 12,
    fontWeight: "600",
  },
  taskActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  scheduleEditor: {
    gap: 10,
    paddingTop: 4,
  },
  scheduleEditorLabel: {
    color: "#415255",
    fontSize: 13,
    fontWeight: "700",
  },
  taskActionButton: {
    borderRadius: 999,
    backgroundColor: "#132A24",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  taskActionButtonText: {
    color: "#FFF8EE",
    fontSize: 12,
    fontWeight: "700",
  },
  deleteButton: {
    backgroundColor: "#F6DED3",
  },
  deleteButtonText: {
    color: "#7F2E14",
  },
  scheduleButton: {
    backgroundColor: "#F1E2B2",
  },
  scheduleButtonText: {
    color: "#6D5513",
  },
  secondaryTaskButton: {
    backgroundColor: "#E8EEE8",
  },
  secondaryTaskButtonText: {
    color: "#27443E",
  },
  suggestButton: {
    backgroundColor: "#DCE8F5",
  },
  suggestButtonText: {
    color: "#2A4A6B",
  },
  suggestRow: {
    flexDirection: "row",
    marginTop: 2,
  },
  suggestionList: {
    gap: 10,
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E4D5BD",
  },
  suggestionEmpty: {
    color: "#6A6258",
    fontSize: 13,
    fontStyle: "italic",
  },
  suggestionCard: {
    backgroundColor: "#F6EFE1",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E2D8C3",
    gap: 6,
  },
  suggestionTime: {
    color: "#1D2A2C",
    fontSize: 14,
    fontWeight: "700",
  },
  suggestionTimeSmall: {
    color: "#415255",
    fontSize: 13,
  },
  reminderList: {
    gap: 6,
    marginTop: 4,
  },
  reminderText: {
    color: "#355B22",
    fontSize: 13,
    fontWeight: "600",
  },
  reminderEmpty: {
    color: "#6A6258",
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 2,
  },
});
