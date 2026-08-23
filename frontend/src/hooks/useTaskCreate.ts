import { useState } from "react";
import { createTask, structureCapture, type Task } from "../lib/tasks";

function parseDateTimeInputValue(value: string) {
  const normalized = value.trim().replace(" ", "T");
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid schedule time in YYYY-MM-DDTHH:MM format.");
  return parsed.toISOString();
}

export function useTaskCreate() {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [draftPriority, setDraftPriority] = useState<Task["priority"]>("medium");
  const [draftDuration, setDraftDuration] = useState("");
  const [scheduledForInput, setScheduledForInput] = useState("");
  const [draftStatus, setDraftStatus] = useState<Extract<Task["status"], "inbox" | "scheduled">>("inbox");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStructuring, setIsStructuring] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleStructureCapture() {
    const captureText = [title, notes].filter(Boolean).join("\n");
    setIsStructuring(true);
    setErrorMessage(null);
    try {
      const suggestion = await structureCapture(captureText);
      setTitle(suggestion.title);
      setNotes(suggestion.notes ?? "");
      setDraftPriority(suggestion.priority);
      setDraftDuration(suggestion.estimated_duration_minutes?.toString() ?? "");
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsStructuring(false);
    }
  }

  async function handleCreateTask() {
    if (!title.trim()) {
      setErrorMessage("Give the task a title before adding it.");
      return;
    }
    const durationInput = draftDuration.trim();
    const estimatedDuration = durationInput ? Number(durationInput) : null;
    if (estimatedDuration !== null && (!Number.isInteger(estimatedDuration) || estimatedDuration <= 0 || estimatedDuration > 1440)) {
      setErrorMessage("Estimated duration must be a whole number between 1 and 1440 minutes.");
      return;
    }
    let dueAt: string | null = null;
    if (draftStatus === "scheduled") {
      try {
        dueAt = parseDateTimeInputValue(scheduledForInput);
      } catch (e: any) {
        setErrorMessage(e?.message ?? String(e));
        return;
      }
      if (dueAt === null) {
        setErrorMessage("Scheduled tasks need a date and time.");
        return;
      }
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await createTask({ title, notes, status: draftStatus, priority: draftPriority, due_at: dueAt, estimated_duration_minutes: estimatedDuration });
      setTitle("");
      setNotes("");
      setDraftPriority("medium");
      setDraftDuration("");
      setScheduledForInput("");
      setDraftStatus("inbox");
      setErrorMessage(null);
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    title,
    setTitle,
    notes,
    setNotes,
    draftPriority,
    setDraftPriority,
    draftDuration,
    setDraftDuration,
    scheduledForInput,
    setScheduledForInput,
    draftStatus,
    setDraftStatus,
    isSubmitting,
    isStructuring,
    errorMessage,
    handleStructureCapture,
    handleCreateTask,
  };
}
