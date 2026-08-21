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

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks`, {
    headers: buildApiHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to load tasks (${response.status})`);
  }

  const payload = (await response.json()) as Task[];
  return payload.map(normalizeTask);
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
  return normalizeTask(payload);
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

export function describeTaskError(error: unknown): string {
  if (!tasksRuntime.isApiMode) {
    return extractErrorMessage(error);
  }

  return `${extractErrorMessage(error)}. Confirm the backend is running and you are signed in with a valid Supabase session.`;
}
