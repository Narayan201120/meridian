import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

export default class Task extends Model {
  static table = "tasks";
  static associations = {};

  // Note: no `!` definite-assignment assertions — Babel's legacy
  // decorators transform rejects them ("cannot be initialized here"),
  // which 500s the whole Metro bundle. strictPropertyInitialization
  // is off in tsconfig.json, so plain declarations typecheck fine.
  @text("title") title: string;
  @text("notes") notes?: string | null;
  @field("status") status: string;
  @field("priority") priority: string;
  @text("due_at") dueAt?: string | null;
  @field("estimated_duration_minutes") estimatedDurationMinutes?: number | null;
  @text("user_id") userId?: string;
  @text("server_id") serverId?: string;
  @readonly @date("updated_at") updatedAt: number;
}
