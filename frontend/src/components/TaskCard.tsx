// Legacy simple card: TaskCard handles toggle/delete/suggest only.
// Canonical is TaskCardEditor (rich editor with edit + schedule flows).
// Kept temporarily for the filtered tabs (inbox/scheduled/due_now/completed);
// new work should use TaskCardEditor via useTaskMutations.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteTask, describeTaskError, suggestBlocks, updateTask, type SuggestedBlock, type Task } from "../lib/tasks";
import { useTasksContext } from "../context/TasksContext";

function formatTaskTime(value: string | null) {
  if (!value) return "No time set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function TaskCard({ task, onChanged, onError }: { task: Task; onChanged?: () => void; onError?: (m: string) => void }) {
  let ctx: any = null;
  try {
    ctx = useTasksContext();
  } catch {
    ctx = null;
  }
  const refresh = onChanged ?? ctx?.refresh ?? (() => {});
  const remindersByTask = ctx?.remindersByTask ?? {};
  const setErrorMessage = onError ?? ctx?.setErrorMessage ?? (() => {});
  const [isBusy, setIsBusy] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedBlock[]>([]);

  async function toggle() {
    setIsBusy(true);
    setAction(task.status === "completed" ? "reopen" : "complete");
    try {
      await updateTask(task.id, { status: task.status === "completed" ? "inbox" : "completed" });
      await refresh();
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsBusy(false);
      setAction(null);
    }
  }
  async function del() {
    setIsBusy(true);
    setAction("delete");
    try {
      await deleteTask(task.id);
      await refresh();
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsBusy(false);
      setAction(null);
    }
  }
  async function suggest() {
    if (suggestOpen) {
      setSuggestOpen(false);
      return;
    }
    setIsBusy(true);
    setAction("suggest");
    try {
      const res = await suggestBlocks(task.id, { max_results: 3 });
      setSuggestions(res.suggestions);
      setSuggestOpen(true);
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsBusy(false);
      setAction(null);
    }
  }
  async function apply(block: SuggestedBlock) {
    setIsBusy(true);
    setAction("schedule");
    try {
      await updateTask(task.id, { status: "scheduled", due_at: block.suggested_start_at });
      await refresh();
      setSuggestOpen(false);
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsBusy(false);
      setAction(null);
    }
  }

  const rems: any[] = remindersByTask?.[task.id] ?? [];

  return (
    <View style={styles.taskCard}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <View style={[styles.badge, task.status === "completed" ? styles.completedBadge : task.status === "scheduled" ? styles.scheduledBadge : task.status === "due_now" ? styles.dueNowBadge : null]}>
          <Text style={styles.badgeText}>{task.status}</Text>
        </View>
      </View>
      {task.notes ? <Text style={styles.taskNotes}>{task.notes}</Text> : null}
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Priority: {task.priority}</Text>
        <Text style={styles.metaText}>{task.estimated_duration_minutes ? `${task.estimated_duration_minutes} min` : "No estimate"}</Text>
      </View>
      {task.status === "scheduled" || task.status === "due_now" ? <Text style={styles.scheduleMetaText}>{task.status === "scheduled" ? "Scheduled for" : "Activated at"}: {formatTaskTime(task.due_at)}</Text> : null}
      {rems.length > 0 ? (
        <View style={styles.reminderList}>
          {rems.map((r: any) => (
            <Text key={r.id} style={styles.reminderText}>Remind {r.type} at {formatTaskTime(r.scheduled_for)} · {r.status}</Text>
          ))}
        </View>
      ) : null}
      <View style={styles.taskActionsRow}>
        <Pressable style={[styles.taskActionButton, isBusy ? styles.buttonDisabled : null]} onPress={toggle} disabled={isBusy}>
          <Text style={styles.taskActionButtonText}>{isBusy && action === "complete" ? "Completing..." : isBusy && action === "reopen" ? "Reopening..." : task.status === "completed" ? "Reopen" : "Complete"}</Text>
        </Pressable>
        <Pressable style={[styles.taskActionButton, styles.deleteButton, isBusy ? styles.buttonDisabled : null]} onPress={del} disabled={isBusy}>
          <Text style={[styles.taskActionButtonText, styles.deleteButtonText]}>{isBusy && action === "delete" ? "Deleting..." : "Delete"}</Text>
        </Pressable>
        {task.status !== "completed" && task.status !== "archived" ? (
          <Pressable style={[styles.taskActionButton, styles.suggestButton, isBusy ? styles.buttonDisabled : null]} onPress={suggest} disabled={isBusy}>
            <Text style={[styles.taskActionButtonText, styles.suggestButtonText]}>{isBusy && action === "suggest" ? "Finding..." : suggestOpen ? "Hide" : "Suggest times"}</Text>
          </Pressable>
        ) : null}
      </View>
      {suggestOpen ? (
        <View style={styles.suggestionList}>
          {suggestions.length === 0 ? <Text style={styles.suggestionEmpty}>No suggestions</Text> : suggestions.map((b) => (
            <View key={b.suggested_start_at} style={styles.suggestionCard}>
              <Text style={styles.suggestionTime}>{formatTaskTime(b.suggested_start_at)}</Text>
              <Text style={styles.suggestionTimeSmall}>→ {formatTaskTime(b.suggested_end_at)}</Text>
              <Pressable style={[styles.taskActionButton, styles.scheduleButton]} onPress={() => apply(b)}><Text style={[styles.taskActionButtonText, styles.scheduleButtonText]}>Schedule here</Text></Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  taskCard: { borderRadius: 18, backgroundColor: "#FFFDF8", borderWidth: 1, borderColor: "#E4D5BD", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  taskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  taskTitle: { flex: 1, color: "#152325", fontSize: 18, lineHeight: 24, fontWeight: "700" },
  badge: { borderRadius: 999, backgroundColor: "#E4F0E7", paddingHorizontal: 10, paddingVertical: 6 },
  completedBadge: { backgroundColor: "#D7E1EF" },
  scheduledBadge: { backgroundColor: "#F3E2B8" },
  dueNowBadge: { backgroundColor: "#F7D9BD" },
  badgeText: { color: "#204636", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  taskNotes: { color: "#5C6462", fontSize: 14, lineHeight: 20 },
  scheduleMetaText: { color: "#705A20", fontSize: 13, fontWeight: "600" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  metaText: { color: "#6A6258", fontSize: 12, fontWeight: "600" },
  taskActionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  taskActionButton: { borderRadius: 999, backgroundColor: "#132A24", paddingHorizontal: 12, paddingVertical: 9 },
  taskActionButtonText: { color: "#FFF8EE", fontSize: 12, fontWeight: "700" },
  deleteButton: { backgroundColor: "#F6DED3" },
  deleteButtonText: { color: "#7F2E14" },
  suggestButton: { backgroundColor: "#DCE8F5" },
  suggestButtonText: { color: "#2A4A6B" },
  scheduleButton: { backgroundColor: "#F1E2B2" },
  scheduleButtonText: { color: "#6D5513" },
  buttonDisabled: { opacity: 0.7 },
  reminderList: { gap: 6, marginTop: 4 },
  reminderText: { color: "#355B22", fontSize: 13, fontWeight: "600" },
  suggestionList: { gap: 10, marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#E4D5BD" },
  suggestionEmpty: { color: "#6A6258", fontSize: 13, fontStyle: "italic" },
  suggestionCard: { backgroundColor: "#F6EFE1", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#E2D8C3", gap: 6 },
  suggestionTime: { color: "#1D2A2C", fontSize: 14, fontWeight: "700" },
  suggestionTimeSmall: { color: "#415255", fontSize: 13 },
});
