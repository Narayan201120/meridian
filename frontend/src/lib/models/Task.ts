import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

export default class Task extends Model {
  static table = "tasks";
  static associations = {};

  @text("title") title!: string;
  @text("notes") notes?: string | null;
  @field("status") status!: string;
  @field("priority") priority!: string;
  @text("due_at") dueAt?: string | null;
  @field("estimated_duration_minutes") estimatedDurationMinutes?: number | null;
  @text("user_id") userId?: string;
  @text("server_id") serverId?: string;
  @readonly @date("updated_at") updatedAt!: number;
}
