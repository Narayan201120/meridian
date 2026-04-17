import { Platform } from "react-native";

export type TaskStatus = "inbox" | "scheduled" | "completed" | "archived";
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
};

export type UpdateTaskInput = Partial<{
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
}>;

type RuntimeShape = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

const runtimeEnv = (globalThis as RuntimeShape).process?.env ?? {};

const defaultApiBaseUrl = Platform.select({
  android: "http://10.0.2.2:8000/api/v1",
  default: "http://localhost:8000/api/v1",
});

const apiBaseUrl = runtimeEnv.EXPO_PUBLIC_API_BASE_URL ?? defaultApiBaseUrl ?? "http://localhost:8000/api/v1";
const devUserId = runtimeEnv.EXPO_PUBLIC_DEV_USER_ID ?? "";

export const tasksRuntime = {
  apiBaseUrl,
  devUserId,
  isApiMode: devUserId.length > 0,
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
    notes: "The backend still uses X-User-Id for development.",
    status: "scheduled",
    priority: "medium",
    due_at: null,
    estimated_duration_minutes: 60,
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

export async function listTasks(): Promise<Task[]> {
  if (!tasksRuntime.isApiMode) {
    return demoTasks;
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks`, {
    headers: {
      "X-User-Id": tasksRuntime.devUserId,
    },
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
      status: "inbox",
      priority: "medium",
      due_at: null,
      estimated_duration_minutes: null,
      created_at: now,
      updated_at: now,
    };

    demoTasks = [task, ...demoTasks];
    return task;
  }

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": tasksRuntime.devUserId,
    },
    body: JSON.stringify({
      title,
      notes,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);

    throw new Error(detail || `Failed to create task (${response.status})`);
  }

  const payload = (await response.json()) as Task;
  return normalizeTask(payload);
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
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": tasksRuntime.devUserId,
    },
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
    headers: {
      "X-User-Id": tasksRuntime.devUserId,
    },
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Failed to delete task (${response.status})`);
  }
}

export function describeTaskError(error: unknown): string {
  if (!tasksRuntime.isApiMode) {
    return extractErrorMessage(error);
  }

  return `${extractErrorMessage(error)}. Confirm the backend is running and EXPO_PUBLIC_DEV_USER_ID matches a real user UUID.`;
}
