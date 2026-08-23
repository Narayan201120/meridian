import { Platform } from "react-native";

import { authRuntime, getAccessToken } from "./auth";

export type TaskStatus = "inbox" | "scheduled" | "due_now" | "completed" | "archived";
export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  estimated_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
};

export type CreateTaskInput = {
  title: string;
  notes?: string;
  status?: Extract<TaskStatus, "inbox" | "scheduled">;
  priority?: TaskPriority;
  due_at?: string | null;
  estimated_duration_minutes?: number | null;
};

export type CaptureSuggestion = {
  title: string;
  notes: string | null;
  priority: TaskPriority;
  estimated_duration_minutes: number | null;
  schedule_intent: "none" | "suggest_time" | "user_requested_block";
  parser: string;
};

export type SuggestedBlock = {
  suggested_start_at: string;
  suggested_end_at: string;
  reason: Record<string, unknown>;
};

export type SuggestBlocksResponse = {
  task_id: string;
  duration_minutes: number;
  suggestions: SuggestedBlock[];
};

export type SuggestBlocksInput = {
  duration_minutes?: number | null;
  time_min?: string | null;
  time_max?: string | null;
  max_results?: number;
};

export type UpdateTaskInput = Partial<{
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  estimated_duration_minutes: number | null;
}>;

const defaultApiBaseUrl = Platform.select({
  android: "http://10.0.2.2:8000/api/v1",
  default: "http://localhost:8000/api/v1",
});

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? defaultApiBaseUrl ?? "http://localhost:8000/api/v1";

export const tasksRuntime = {
  apiBaseUrl,
  isApiMode: authRuntime.isConfigured,
};

// WatermelonDB offline cache helpers (lean, no new file for sync logic)
let dbAvailable: boolean | null = null;
async function getDb() {
  if (dbAvailable === false) return null;
  try {
    const { database } = await import("./db");
    dbAvailable = true;
    return database;
  } catch {
    dbAvailable = false;
    return null;
  }
}

async function cacheTasks(tasks: Task[]) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.write(async () => {
      const collection = db.get("tasks");
      for (const t of tasks) {
        const existing = await collection.query().fetch();
        const found = existing.find((m: any) => m.serverId === t.id);
        if (found) {
          await found.update((m: any) => {
            m.title = t.title;
            m.notes = t.notes ?? "";
            m.status = t.status;
            m.priority = t.priority;
            m.dueAt = t.due_at ?? "";
            m.estimatedDurationMinutes = t.estimated_duration_minutes ?? null;
            m.userId = t.user_id;
            m.serverId = t.id;
          });
        } else {
          await collection.create((m: any) => {
            m.title = t.title;
            m.notes = t.notes ?? "";
            m.status = t.status;
            m.priority = t.priority;
            m.dueAt = t.due_at ?? "";
            m.estimatedDurationMinutes = t.estimated_duration_minutes ?? null;
            m.userId = t.user_id;
            m.serverId = t.id;
          });
        }
      }
    });
  } catch {
    // ignore cache errors
  }
}

async function getCachedTasks(): Promise<Task[] | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const collection = db.get("tasks");
    const models: any[] = await collection.query().fetch();
    if (models.length === 0) return null;
    return models.map((m) => ({
      id: m.serverId || m.id,
      user_id: m.userId || "cached-user",
      title: m.title,
      notes: m.notes || null,
      status: m.status as TaskStatus,
      priority: m.priority as TaskPriority,
      due_at: m.dueAt || null,
      estimated_duration_minutes: m.estimatedDurationMinutes ?? null,
      created_at: new Date(m.updatedAt || Date.now()).toISOString(),
      updated_at: new Date(m.updatedAt || Date.now()).toISOString(),
    }));
  } catch {
    return null;
  }
}

let demoTasks: Task[] = [
  {
    id: "demo-1",
    user_id: "demo-user",
    title: "Wire Expo task list to FastAPI",
    notes: "Replace the placeholder landing screen with a real task flow.",
    status: "inbox",
    priority: "high",
    due_at: null,
    estimated_duration_minutes: 45,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "demo-2",
    user_id: "demo-user",
    title: "Swap temporary auth for Supabase JWT",
    notes: "The backend now verifies Supabase bearer tokens and the frontend signs in through Supabase.",
    status: "scheduled",
    priority: "medium",
    due_at: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
    estimated_duration_minutes: 60,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "demo-3",
    user_id: "demo-user",
    title: "Ship the due-now experience",
    notes: "Scheduled work should activate and ask for attention when its time arrives.",
    status: "due_now",
    priority: "high",
    due_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    estimated_duration_minutes: 30,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function normalizeTask(task: Task): Task {
  return {
    ...task,
    notes: task.notes ?? null,
    due_at: task.due_at ?? null,
    estimated_duration_minutes: task.estimated_duration_minutes ?? null,
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    return JSON.stringify(await response.json());
  } catch {
    return await response.text();
  }
}

function buildApiHeaders(contentType?: string): HeadersInit {
  const accessToken = getAccessToken();

  if (accessToken === null) {
    throw new Error("Sign in to access live tasks.");
  }

  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function listTasks(): Promise<Task[]> {
  if (!tasksRuntime.isApiMode) {
    return demoTasks;
  }

  try {
    const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks`, {
      headers: buildApiHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to load tasks (${response.status})`);
    }

    const payload = (await response.json()) as Task[];
    const normalized = payload.map(normalizeTask);
    void cacheTasks(normalized);
    return normalized;
  } catch (error) {
    const cached = await getCachedTasks();
    if (cached && cached.length > 0) return cached;
    throw error;
  }
}

export async function syncTasksFromMutations(since?: string): Promise<Task[]> {
  if (!tasksRuntime.isApiMode) return [];
  const url = since ? `${tasksRuntime.apiBaseUrl}/tasks/mutations?since=${encodeURIComponent(since)}` : `${tasksRuntime.apiBaseUrl}/tasks/mutations`;
  const response = await fetch(url, { headers: buildApiHeaders() });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to sync mutations (${response.status})`);
  }
  // For lean, just re-fetch tasks after mutations
  return listTasks();
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const title = input.title.trim();
  const notes = input.notes?.trim() || null;
  const status = input.status ?? "inbox";
  const priority = input.priority ?? "medium";
  const dueAt = input.due_at ?? null;
  const estimatedDuration = input.estimated_duration_minutes ?? null;

  if (!title) {
    throw new Error("Task title cannot be blank.");
  }

  if (!tasksRuntime.isApiMode) {
    const now = new Date().toISOString();
    const task: Task = {
      id: `demo-${Date.now()}`,
      user_id: "demo-user",
      title,
      notes,
      status,
      priority,
      due_at: dueAt,
      estimated_duration_minutes: estimatedDuration,
      created_at: now,
      updated_at: now,
    };

    demoTasks = [task, ...demoTasks];
    return task;
  }

  try {
    const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks`, {
      method: "POST",
      headers: buildApiHeaders("application/json"),
      body: JSON.stringify({
        title,
        notes,
        status,
        priority,
        due_at: dueAt,
        estimated_duration_minutes: estimatedDuration,
      }),
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);

      throw new Error(detail || `Failed to create task (${response.status})`);
    }

    const payload = (await response.json()) as Task;
    const normalized = normalizeTask(payload);
    void cacheTasks([normalized]);
    return normalized;
  } catch (error) {
    // Offline fallback: cache locally with temp id
    const now = new Date().toISOString();
    const offlineTask: Task = {
      id: `offline-${Date.now()}`,
      user_id: "offline-user",
      title,
      notes,
      status,
      priority,
      due_at: dueAt,
      estimated_duration_minutes: estimatedDuration,
      created_at: now,
      updated_at: now,
    };
    void cacheTasks([offlineTask]);
    // If error was network, return offline task; else throw original
    if (error instanceof TypeError && error.message.includes("fetch")) return offlineTask;
    // For other errors (validation) still throw
    if (offlineTask.id.startsWith("offline-") && (error as Error).message.includes("Failed to")) {
      // If create failed due to offline, return offline task
      const cached = await getCachedTasks();
      if (cached) return offlineTask;
    }
    throw error;
  }
}

export async function structureCapture(text: string): Promise<CaptureSuggestion> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error("Add a title or notes before structuring the capture.");
  }

  if (!tasksRuntime.isApiMode) {
    const durationMatch = normalizedText.match(/\b(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i);
    const quantity = durationMatch ? Number(durationMatch[1]) : null;
    const unit = durationMatch?.[2]?.toLowerCase() ?? "";
    const estimatedDuration = quantity === null ? null : unit.startsWith("h") ? quantity * 60 : quantity;
    const normalized = normalizedText.toLowerCase();

    return {
      title: normalizedText.split(/\r?\n/)[0] ?? normalizedText,
      notes: normalizedText.split(/\r?\n/).slice(1).join("\n") || null,
      priority: /urgent|asap|critical|important/.test(normalized)
        ? "high"
        : /someday|whenever|low priority/.test(normalized)
          ? "low"
          : "medium",
      estimated_duration_minutes: estimatedDuration && estimatedDuration <= 1_440 ? estimatedDuration : null,
      schedule_intent: /block/.test(normalized) && /calendar|time/.test(normalized)
        ? "user_requested_block"
        : /schedule|calendar|when should|find time/.test(normalized)
          ? "suggest_time"
          : "none",
      parser: "heuristic_v1",
    };
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/captures/structure`, {
    method: "POST",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify({ text: normalizedText }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to structure capture (${response.status})`);
  }

  return (await response.json()) as CaptureSuggestion;
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  if (!tasksRuntime.isApiMode) {
    const existingTask = demoTasks.find((task) => task.id === taskId);

    if (!existingTask) {
      throw new Error("Task not found.");
    }

    const now = new Date().toISOString();
    const nextTask = normalizeTask({
      ...existingTask,
      ...input,
      updated_at: now,
    });

    demoTasks = demoTasks.map((task) => (task.id === taskId ? nextTask : task));
    return nextTask;
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/${taskId}`, {
    method: "PATCH",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to update task (${response.status})`);
  }

  const payload = (await response.json()) as Task;
  return normalizeTask(payload);
}

export async function deleteTask(taskId: string): Promise<void> {
  if (!tasksRuntime.isApiMode) {
    demoTasks = demoTasks.filter((task) => task.id !== taskId);
    return;
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/${taskId}`, {
    method: "DELETE",
    headers: buildApiHeaders(),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to delete task (${response.status})`);
  }
}

export async function getCalendarStatus(): Promise<string> {
  if (!tasksRuntime.isApiMode) {
    return "not_connected";
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/calendar/google/status`, {
    headers: buildApiHeaders(),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to load calendar status (${response.status})`);
  }

  const payload = (await response.json()) as { status: string };
  return payload.status;
}

export async function suggestBlocks(taskId: string, input: SuggestBlocksInput = {}): Promise<SuggestBlocksResponse> {
  if (!tasksRuntime.isApiMode) {
    const now = new Date();
    const duration = input.duration_minutes ?? 30;
    const suggestions: SuggestedBlock[] = Array.from({ length: input.max_results ?? 3 }, (_, idx) => {
      const start = new Date(now.getTime() + (idx + 1) * 60 * 60 * 1000);
      start.setMinutes(0, 0, 0);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      return {
        suggested_start_at: start.toISOString(),
        suggested_end_at: end.toISOString(),
        reason: { kind: "demo_gap", duration_minutes: duration },
      };
    });
    return { task_id: taskId, duration_minutes: duration, suggestions };
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/${taskId}/suggest-blocks`, {
    method: "POST",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify({
      duration_minutes: input.duration_minutes ?? null,
      time_min: input.time_min ?? null,
      time_max: input.time_max ?? null,
      max_results: input.max_results ?? 3,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to suggest blocks (${response.status})`);
  }

  return (await response.json()) as SuggestBlocksResponse;
}

export type TaskCalendarBlock = {
  id: string;
  user_id: string;
  task_id: string;
  calendar_connection_id: string;
  calendar_event_id: string | null;
  status: string;
  suggested_start_at: string;
  suggested_end_at: string;
  suggestion_reason: Record<string, unknown>;
  approved_at: string | null;
  write_requested_at: string | null;
  write_completed_at: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};

export async function createTaskCalendarBlock(taskId: string, block: SuggestedBlock): Promise<TaskCalendarBlock> {
  if (!tasksRuntime.isApiMode) {
    return {
      id: `demo-block-${Date.now()}`,
      user_id: "demo-user",
      task_id: taskId,
      calendar_connection_id: "demo-conn",
      calendar_event_id: null,
      status: "suggested",
      suggested_start_at: block.suggested_start_at,
      suggested_end_at: block.suggested_end_at,
      suggestion_reason: block.reason,
      approved_at: null,
      write_requested_at: null,
      write_completed_at: null,
      last_error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/${taskId}/blocks`, {
    method: "POST",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify({
      suggested_start_at: block.suggested_start_at,
      suggested_end_at: block.suggested_end_at,
      suggestion_reason: block.reason,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to create calendar block (${response.status})`);
  }

  return (await response.json()) as TaskCalendarBlock;
}

export async function confirmTaskCalendarBlock(taskId: string, blockId: string): Promise<TaskCalendarBlock> {
  if (!tasksRuntime.isApiMode) {
    return {
      id: blockId,
      user_id: "demo-user",
      task_id: taskId,
      calendar_connection_id: "demo-conn",
      calendar_event_id: `demo-evt-${Date.now()}`,
      status: "confirmed",
      suggested_start_at: new Date().toISOString(),
      suggested_end_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      suggestion_reason: { external_event_id: `demo-evt-${Date.now()}` },
      approved_at: new Date().toISOString(),
      write_requested_at: new Date().toISOString(),
      write_completed_at: new Date().toISOString(),
      last_error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/${taskId}/blocks/${blockId}/confirm`, {
    method: "POST",
    headers: buildApiHeaders(),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to confirm calendar block (${response.status})`);
  }

  return (await response.json()) as TaskCalendarBlock;
}

export type Reminder = {
  id: string;
  task_id: string | null;
  task_calendar_block_id: string | null;
  type: string;
  scheduled_for: string;
  status: string;
  delivery_channel: string;
  local_only: boolean;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listReminders(taskId: string): Promise<Reminder[]> {
  if (!tasksRuntime.isApiMode) {
    // Demo: no reminders until scheduled in demo mode
    return [];
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/${taskId}/reminders`, {
    headers: buildApiHeaders(),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to list reminders (${response.status})`);
  }

  return (await response.json()) as Reminder[];
}

export async function dispatchReminders(): Promise<{ dispatched: number; reminders: Reminder[] }> {
  if (!tasksRuntime.isApiMode) {
    return { dispatched: 0, reminders: [] };
  }
  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/reminders/dispatch`, {
    method: "POST",
    headers: buildApiHeaders(),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to dispatch reminders (${response.status})`);
  }
  return (await response.json()) as { dispatched: number; reminders: Reminder[] };
}

export async function acknowledgeReminder(reminderId: string): Promise<Reminder> {
  if (!tasksRuntime.isApiMode) {
    return {
      id: reminderId,
      task_id: null,
      task_calendar_block_id: null,
      type: "due_date",
      scheduled_for: new Date().toISOString(),
      status: "sent",
      delivery_channel: "push",
      local_only: false,
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks/reminders/${reminderId}/ack`, {
    method: "POST",
    headers: buildApiHeaders(),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to ack reminder (${response.status})`);
  }
  return (await response.json()) as Reminder;
}

export async function listAllReminders(status?: string): Promise<Reminder[]> {
  if (!tasksRuntime.isApiMode) return [];
  const url = status ? `${tasksRuntime.apiBaseUrl}/tasks/reminders/list?status_filter=${status}` : `${tasksRuntime.apiBaseUrl}/tasks/reminders/list`;
  const response = await fetch(url, { headers: buildApiHeaders() });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to list reminders (${response.status})`);
  }
  return (await response.json()) as Reminder[];
}

export type VoiceCaptureResponse = {
  voice_capture_id: string;
  transcript: string;
  suggestion: CaptureSuggestion;
  task_id: string | null;
};

export async function captureVoice(transcript: string, createTaskFlag = true): Promise<VoiceCaptureResponse> {
  const normalized = transcript.trim();
  if (!normalized) throw new Error("Transcript cannot be blank.");
  if (!tasksRuntime.isApiMode) {
    const suggestion: CaptureSuggestion = {
      title: normalized.split(/\r?\n/)[0] ?? normalized,
      notes: normalized.split(/\r?\n/).slice(1).join("\n") || null,
      priority: /urgent|asap|critical|important/.test(normalized.toLowerCase()) ? "high" : "medium",
      estimated_duration_minutes: null,
      schedule_intent: "none",
      parser: "heuristic_v1",
    };
    let taskId: string | null = null;
    if (createTaskFlag) {
      const t = await createTask({ title: suggestion.title, notes: suggestion.notes ?? undefined, priority: suggestion.priority });
      taskId = t.id;
    }
    return { voice_capture_id: `demo-vc-${Date.now()}`, transcript: normalized, suggestion, task_id: taskId };
  }
  const response = await fetch(`${tasksRuntime.apiBaseUrl}/captures/voice`, {
    method: "POST",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify({ transcript: normalized, create_task: createTaskFlag }),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to capture voice (${response.status})`);
  }
  return (await response.json()) as VoiceCaptureResponse;
}

export async function syncCalendarEvents(timeMin: string, timeMax: string): Promise<{ synced: number }> {
  if (!tasksRuntime.isApiMode) return { synced: 0 };
  const response = await fetch(`${tasksRuntime.apiBaseUrl}/calendar/google/sync`, {
    method: "POST",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify({ time_min: timeMin, time_max: timeMax }),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to sync calendar (${response.status})`);
  }
  return (await response.json()) as { synced: number };
}

export function describeTaskError(error: unknown): string {
  if (!tasksRuntime.isApiMode) {
    return extractErrorMessage(error);
  }

  return `${extractErrorMessage(error)}. Confirm the backend is running and you are signed in with a valid Supabase session.`;
}
