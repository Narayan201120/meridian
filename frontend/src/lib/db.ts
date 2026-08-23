import { Database } from "@nozbe/watermelondb";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";
import { appSchema, tableSchema } from "@nozbe/watermelondb";

import TaskModel from "./models/Task";

// Keep schema lean: only tasks for offline-first MVP, other tables (reminders, voice) can be added later without new file
export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: "tasks",
      columns: [
        { name: "title", type: "string" },
        { name: "notes", type: "string", isOptional: true },
        { name: "status", type: "string" },
        { name: "priority", type: "string" },
        { name: "due_at", type: "string", isOptional: true },
        { name: "estimated_duration_minutes", type: "number", isOptional: true },
        { name: "user_id", type: "string", isOptional: true },
        { name: "updated_at", type: "number", isOptional: true },
        { name: "server_id", type: "string", isIndexed: true, isOptional: true },
      ],
    }),
  ],
});

const adapter = new LokiJSAdapter({
  schema,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  dbName: "meridian",
  onSetUpError: (error) => console.warn("[WatermelonDB] setup error", error),
});

export const database = new Database({
  adapter,
  modelClasses: [TaskModel],
});

// Helper to check if DB is available (e.g., web IndexedDB)
export function isDbAvailable(): boolean {
  try {
    return !!database;
  } catch {
    return false;
  }
}
