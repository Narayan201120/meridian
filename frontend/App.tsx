import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Badge } from "./src/components/ui/Badge";
import { Button } from "./src/components/ui/Button";
import { Card } from "./src/components/ui/Card";
import { InputField } from "./src/components/ui/InputField";
import { PageShell } from "./src/components/ui/PageShell";
import { SectionHeader } from "./src/components/ui/SectionHeader";
import { StatusBanner } from "./src/components/ui/StatusBanner";
import { CreateTaskForm } from "./src/components/CreateTaskForm";
import { VoiceCaptureCard } from "./src/components/VoiceCaptureCard";
import { TaskList } from "./src/components/TaskList";

import {
  authRuntime,
  getCurrentSession,
  signInWithPassword,
  signOut,
  type AuthSession,
} from "./src/lib/auth";
import {
  acknowledgeReminder,
  captureVoice,
  confirmTaskCalendarBlock,
  createTaskCalendarBlock,
  createTask,
  deleteTask,
  dispatchReminders,
  getCalendarStatus,
  listAllReminders,
  listReminders,
  pushPendingOfflineTasks,
  structureCapture,
  describeTaskError,
  listTasks,
  suggestBlocks,
  syncCalendarEvents,
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
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getCurrentSession());
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [remindersByTask, setRemindersByTask] = useState<Record<string, Reminder[]>>({});
  const [pendingReminders, setPendingReminders] = useState<Reminder[]>([]);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

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

  useEffect(() => {
    if (!tasksRuntime.isApiMode || authSession === null) {
      setCalendarStatus(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const status = await getCalendarStatus();
        if (!cancelled) setCalendarStatus(status);
      } catch {
        if (!cancelled) setCalendarStatus("unknown");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authSession]);

  function replaceTask(nextTask: Task) {
    setTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === nextTask.id ? nextTask : task)),
    );
  }



  async function handleSyncCalendar() {
    if (!tasksRuntime.isApiMode || calendarStatus !== "active") {
      setErrorMessage("Connect Google Calendar first.");
      return;
    }
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await syncCalendarEvents(timeMin, timeMax);
      setDispatchNotice(`Calendar synced — ${res.synced} events cached for 7 days`);
      // refresh calendar status last_synced
      const status = await getCalendarStatus();
      setCalendarStatus(status);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsSyncing(false);
    }
  }


  async function handleSignIn() {
    if (!authEmail.trim() || !authPassword) {
      setErrorMessage("Enter the email and password for your Supabase user.");
      return;
    }

    setIsSigningIn(true);
    setErrorMessage(null);

    try {
      const session = await signInWithPassword(authEmail, authPassword);
      setAuthSession(session);
      setAuthPassword("");
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    setErrorMessage(null);

    try {
      await signOut();
      setAuthSession(null);
      setTasks([]);
    } catch (error) {
      setErrorMessage(describeTaskError(error));
    } finally {
      setIsSigningOut(false);
    }
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
    const isBusy = activeTaskId === task.id;
    const isEditingSchedule = scheduleEditorTaskId === task.id;
    const isEditingTask = taskEditorTaskId === task.id;

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
              onChangeText={setTaskEditorTitle}
            />
            <TextInput
              placeholder="Notes (optional)"
              placeholderTextColor="#7D7A70"
              style={[styles.input, styles.notesInput]}
              value={taskEditorNotes}
              onChangeText={setTaskEditorNotes}
              multiline
            />
            <TextInput
              placeholder="Estimated duration in minutes (optional)"
              placeholderTextColor="#7D7A70"
              style={styles.input}
              value={taskEditorDuration}
              onChangeText={setTaskEditorDuration}
              keyboardType="number-pad"
            />
            <View style={styles.filterRow}>
              {(["low", "medium", "high"] as const).map((priority) => {
                const isSelected = taskEditorPriority === priority;
                return (
                  <Pressable
                    key={priority}
                    style={[styles.filterChip, isSelected ? styles.filterChipActive : null]}
                    onPress={() => setTaskEditorPriority(priority)}
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
                onPress={() => void handleSaveTaskDetails(task)}
                disabled={isBusy}
              >
                <Text style={styles.taskActionButtonText}>
                  {isBusy && activeTaskAction === "edit" ? "Saving..." : "Save details"}
                </Text>
              </Pressable>
              <Pressable style={[styles.taskActionButton, styles.secondaryTaskButton]} onPress={closeTaskEditor}>
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

        {(remindersByTask[task.id] ?? []).length > 0 ? (
          <View style={styles.reminderList}>
            {(remindersByTask[task.id] ?? []).map((r) => (
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
              onChangeText={setScheduleEditorValue}
              autoCapitalize="none"
            />
            <TextInput
              placeholder="Estimated duration in minutes (optional)"
              placeholderTextColor="#7D7A70"
              style={styles.input}
              value={taskEditorDuration}
              onChangeText={setTaskEditorDuration}
              keyboardType="number-pad"
            />
            <View style={styles.filterRow}>
              {(["low", "medium", "high"] as const).map((priority) => {
                const isSelected = taskEditorPriority === priority;
                return (
                  <Pressable
                    key={priority}
                    style={[styles.filterChip, isSelected ? styles.filterChipActive : null]}
                    onPress={() => setTaskEditorPriority(priority)}
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
                onPress={() => void handleSaveSchedule(task)}
                disabled={isBusy}
              >
                <Text style={[styles.taskActionButtonText, styles.scheduleButtonText]}>
                  {isBusy && activeTaskAction === "schedule" ? "Saving..." : "Save schedule"}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.taskActionButton, styles.secondaryTaskButton]}
                onPress={() => {
                  setScheduleEditorTaskId(null);
                  setScheduleEditorValue("");
                }}
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
              onPress={() => handleOpenTaskEditor(task)}
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
              onPress={() => handleOpenScheduleEditor(task)}
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
              onPress={() => void handleUnscheduleTask(task)}
              disabled={isBusy}
            >
              <Text style={[styles.taskActionButtonText, styles.secondaryTaskButtonText]}>
                {isBusy && activeTaskAction === "unschedule" ? "Moving..." : "Move to inbox"}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            style={[styles.taskActionButton, isBusy ? styles.buttonDisabled : null]}
            onPress={() => void handleToggleTaskStatus(task)}
            disabled={isBusy}
          >
            <Text style={styles.taskActionButtonText}>
              {isBusy && activeTaskAction === "complete"
                ? "Completing..."
                : isBusy && activeTaskAction === "reopen"
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
            onPress={() => void handleDeleteTask(task.id)}
            disabled={isBusy}
          >
            <Text style={[styles.taskActionButtonText, styles.deleteButtonText]}>
              {isBusy && activeTaskAction === "delete" ? "Deleting..." : "Delete"}
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
              onPress={() => void handleSuggestBlocks(task)}
              disabled={isBusy}
            >
              <Text style={[styles.taskActionButtonText, styles.suggestButtonText]}>
                {isBusy && activeTaskAction === "suggest"
                  ? "Finding..."
                  : suggestTaskId === task.id
                    ? "Hide suggestions"
                    : "Suggest times"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {suggestTaskId === task.id ? (
          <View style={styles.suggestionList}>
            {(suggestionsByTask[task.id] ?? []).length === 0 ? (
              <Text style={styles.suggestionEmpty}>No suggestions loaded yet. Tap Suggest times again.</Text>
            ) : (
              (suggestionsByTask[task.id] ?? []).map((block) => (
                <View key={block.suggested_start_at} style={styles.suggestionCard}>
                  <Text style={styles.suggestionTime}>{formatTaskTime(block.suggested_start_at)}</Text>
                  <Text style={styles.suggestionTimeSmall}>→ {formatTaskTime(block.suggested_end_at)}</Text>
                  <Pressable
                    style={[styles.taskActionButton, styles.scheduleButton, isBusy ? styles.buttonDisabled : null]}
                    onPress={() => void handleApplySuggestion(task, block)}
                    disabled={isBusy}
                  >
                    <Text style={[styles.taskActionButtonText, styles.scheduleButtonText]}>
                      {isBusy && activeTaskAction === "schedule" ? "Scheduling..." : "Schedule here"}
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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <PageShell>
          <Card variant="hero">
            <Text style={styles.kicker}>Meridian</Text>
            <Text style={styles.title}>Capture a task, then give it somewhere real to go.</Text>
            <Text style={styles.subtitle}>
              This is the first live task flow. In demo mode it runs locally. In API mode it talks
              to the FastAPI backend with a real Supabase bearer token.
            </Text>
          </Card>

          <Card variant="floating">
            <View>
              <Text style={styles.cardEyebrow}>
                {tasksRuntime.isApiMode ? "API mode" : "Demo mode"}
              </Text>
              <Text style={styles.modeTitle}>
                {tasksRuntime.isApiMode
                  ? authSession
                    ? "Frontend is calling the backend with a Supabase bearer token."
                    : "Sign in with your Supabase user to load live tasks."
                  : "Frontend is using local demo data until Supabase auth is configured."}
              </Text>
              <Text style={styles.modeBody}>Base URL: {tasksRuntime.apiBaseUrl}</Text>
              {tasksRuntime.isApiMode && authSession ? (
                <>
                  <Text style={styles.modeBody}>
                    Signed in as {authSession.user.email ?? authSession.user.id}
                  </Text>
                  <Text style={styles.modeBody}>
                    Calendar: {calendarStatus ?? "checking..."}
                  </Text>
                </>
              ) : null}
            </View>

            {tasksRuntime.isApiMode && authSession ? (
              <View className="flex-row flex-wrap gap-2">
                <Button variant="secondary" size="sm" onPress={() => void loadTasks()}>
                  Refresh
                </Button>
                {calendarStatus === "active" ? (
                  <Button variant="secondary" size="sm" loading={isSyncing} onPress={() => void handleSyncCalendar()}>
                    {isSyncing ? "Syncing..." : "Sync calendar"}
                  </Button>
                ) : null}
                <Button variant="destructive" size="sm" loading={isSigningOut} onPress={() => void handleSignOut()}>
                  {isSigningOut ? "Signing out..." : "Sign out"}
                </Button>
              </View>
            ) : (
              <Button variant="secondary" size="sm" onPress={() => void loadTasks()}>
                {tasksRuntime.isApiMode ? "Retry" : "Refresh"}
              </Button>
            )}
          </Card>

          {tasksRuntime.isApiMode && authSession === null ? (
            <Card variant="floating" className="gap-4">
              <SectionHeader
                eyebrow="SIGN IN"
                title="Use your Supabase user"
                body="Sign in with the local auth user you created in Supabase Studio so the task flow uses the same bearer-token auth path the backend now enforces."
              />
              <InputField
                label="Email"
                placeholder="you@example.com"
                value={authEmail}
                onChangeText={setAuthEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
              />
              <InputField
                label="Password"
                placeholder="••••••••"
                value={authPassword}
                onChangeText={setAuthPassword}
                secureTextEntry
                textContentType="password"
              />
              <Button variant="primary" size="md" loading={isSigningIn} onPress={() => void handleSignIn()}>
                {isSigningIn ? "Signing in..." : "Sign in"}
              </Button>
            </Card>

          ) : (
            <>
              <CreateTaskForm />
              <VoiceCaptureCard />

              {errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} actionLabel="Retry" onAction={() => void loadTasks()} /> : null}

              {dueNotice ? <StatusBanner variant="success" title="Due now" message={dueNotice} /> : null}

              {dispatchNotice ? <StatusBanner variant="success" title="Reminders" message={dispatchNotice} /> : null}

              {pendingReminders.length > 0 ? (
                <View className="bg-[#FFFDF8] border border-[#E2E8F0] rounded-2xl p-6 md:p-8 shadow-sm gap-4">
                  <Text style={styles.cardEyebrow}>Pending reminders</Text>
                  <Text style={styles.sectionBody}>
                    {pendingReminders.length} reminder{pendingReminders.length > 1 ? "s" : ""} waiting for delivery. Tap ack when seen.
                  </Text>
                  {pendingReminders.map((r) => (
                    <View key={r.id} style={styles.suggestionCard}>
                      <Text style={styles.suggestionTime}>{r.type === "scheduled_block" ? "Block" : "Due"} — {formatTaskTime(r.scheduled_for)}</Text>
                      <Text style={styles.suggestionTimeSmall}>{r.status} · {r.id.slice(0, 8)}</Text>
                      <Pressable
                        style={[styles.taskActionButton, styles.secondaryTaskButton]}
                        onPress={async () => {
                          try {
                            await acknowledgeReminder(r.id);
                            setPendingReminders((prev) => prev.filter((x) => x.id !== r.id));
                          } catch (e) {
                            setErrorMessage(describeTaskError(e));
                          }
                        }}
                      >
                        <Text style={[styles.taskActionButtonText, styles.secondaryTaskButtonText]}>Ack</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3EBDD",
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 18,
  },
  hero: {
    backgroundColor: "#132A24",
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 26,
    shadowColor: "#132A24",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  kicker: {
    color: "#DAB785",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  title: {
    color: "#FFF8EE",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    marginBottom: 12,
  },
  subtitle: {
    color: "#D9E3DC",
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: "#FFF9F0",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E5D6BF",
    gap: 12,
  },
  modeCard: {
    backgroundColor: "#FFF3D7",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E8C994",
    gap: 14,
  },
  modeActions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  cardEyebrow: {
    color: "#B45A36",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  modeTitle: {
    color: "#1D2A2C",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  modeBody: {
    color: "#4C4A43",
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    color: "#1D2A2C",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
  },
  sectionBody: {
    color: "#415255",
    fontSize: 15,
    lineHeight: 22,
  },
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
  primaryButton: {
    backgroundColor: "#132A24",
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#FFF8EE",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#132A24",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#FFF8EE",
    fontSize: 13,
    fontWeight: "700",
  },
  signOutButton: {
    backgroundColor: "#F6DED3",
  },
  signOutButtonText: {
    color: "#7F2E14",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  errorCard: {
    borderRadius: 20,
    backgroundColor: "#F9D4C7",
    borderWidth: 1,
    borderColor: "#E4A08B",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 8,
  },
  errorLabel: {
    color: "#7F2E14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  errorText: {
    color: "#602512",
    fontSize: 14,
    lineHeight: 20,
  },
  noticeCard: {
    borderRadius: 20,
    backgroundColor: "#E5F1DE",
    borderWidth: 1,
    borderColor: "#B8D4AA",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 8,
  },
  noticeLabel: {
    color: "#355B22",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  noticeText: {
    color: "#28451A",
    fontSize: 14,
    lineHeight: 20,
  },
  loadingState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    color: "#415255",
    fontSize: 14,
  },
  emptyState: {
    borderRadius: 22,
    backgroundColor: "#F6EFE1",
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#E2D8C3",
  },
  emptyTitle: {
    color: "#1D2A2C",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptyBody: {
    color: "#5B615D",
    fontSize: 14,
    lineHeight: 20,
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
  filterCountPill: {
    minWidth: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#FFF9F0",
    alignItems: "center",
  },
  filterCountPillActive: {
    backgroundColor: "#33594F",
  },
  filterCountText: {
    color: "#5B615D",
    fontSize: 11,
    fontWeight: "800",
  },
  filterCountTextActive: {
    color: "#FFF8EE",
  },
  taskSections: {
    gap: 18,
  },
  taskSection: {
    gap: 12,
  },
  taskSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskSectionTitle: {
    color: "#1D2A2C",
    fontSize: 18,
    fontWeight: "700",
  },
  taskSectionCount: {
    color: "#6A6258",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  groupEmptyState: {
    borderRadius: 18,
    backgroundColor: "#F6EFE1",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "#E2D8C3",
    gap: 6,
  },
  groupEmptyTitle: {
    color: "#1D2A2C",
    fontSize: 16,
    fontWeight: "700",
  },
  groupEmptyBody: {
    color: "#5B615D",
    fontSize: 14,
    lineHeight: 20,
  },
  taskList: {
    gap: 12,
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
