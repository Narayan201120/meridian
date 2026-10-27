import type { Task } from "./tasks";

const TASKS_KEY = "meridian.tasks.cache.v1";
const PENDING_KEY = "meridian.tasks.pending.v1";

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    return null;
  }
  return null;
}

let memoryTasks: Task[] | null = null;
let memoryPending: Task[] | null = null;

export function readCachedTasksSync(): Task[] | null {
  if (memoryTasks !== null) return memoryTasks;
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(TASKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Task[];
    if (!Array.isArray(parsed)) return null;
    memoryTasks = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function readCachedTasks(): Promise<Task[] | null> {
  return readCachedTasksSync();
}

export async function writeCachedTasks(tasks: Task[]): Promise<void> {
  memoryTasks = tasks.slice(0, 200);
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(TASKS_KEY, JSON.stringify(memoryTasks));
  } catch {
    // Quota or private mode. Memory copy still serves this session.
  }
}

export async function appendCachedTask(task: Task): Promise<void> {
  const current = readCachedTasksSync() ?? [];
  const next = [task, ...current.filter((t) => t.id !== task.id)].slice(0, 200);
  await writeCachedTasks(next);
}

export async function readPendingTasks(): Promise<Task[]> {
  if (memoryPending !== null) return memoryPending;
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) {
      memoryPending = [];
      return [];
    }
    const parsed = JSON.parse(raw) as Task[];
    memoryPending = Array.isArray(parsed) ? parsed : [];
    return memoryPending;
  } catch {
    return [];
  }
}

export async function writePendingTasks(tasks: Task[]): Promise<void> {
  memoryPending = tasks;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(tasks));
  } catch {
    // Best effort.
  }
}

export async function clearPendingTasks(): Promise<void> {
  await writePendingTasks([]);
}

export function isDbAvailable(): boolean {
  return true;
}
