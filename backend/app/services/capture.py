import re

from app.models.task import ScheduleIntent, TaskPriority
from app.schemas.capture import TaskCaptureSuggestion


class TaskCaptureService:
    _duration_pattern = re.compile(r"\b(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)\b", re.IGNORECASE)

    def structure(self, text: str) -> TaskCaptureSuggestion:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        title = lines[0][:280]
        notes = "\n".join(lines[1:]) or None
        normalized = text.lower()

        return TaskCaptureSuggestion(
            title=title,
            notes=notes,
            priority=self._infer_priority(normalized),
            estimated_duration_minutes=self._infer_duration(normalized),
            schedule_intent=self._infer_schedule_intent(normalized),
        )

    @staticmethod
    def _infer_priority(text: str) -> TaskPriority:
        if any(keyword in text for keyword in ("urgent", "asap", "critical", "important")):
            return TaskPriority.HIGH
        if any(keyword in text for keyword in ("someday", "whenever", "low priority")):
            return TaskPriority.LOW
        return TaskPriority.MEDIUM

    def _infer_duration(self, text: str) -> int | None:
        match = self._duration_pattern.search(text)
        if match is None:
            return None

        quantity = int(match.group(1))
        unit = match.group(2).lower()
        minutes = quantity * 60 if unit.startswith(("h", "hour")) else quantity
        return minutes if 0 < minutes <= 1_440 else None

    @staticmethod
    def _infer_schedule_intent(text: str) -> ScheduleIntent:
        if "block" in text and any(keyword in text for keyword in ("calendar", "time")):
            return ScheduleIntent.USER_REQUESTED_BLOCK
        if any(keyword in text for keyword in ("schedule", "calendar", "when should", "find time")):
            return ScheduleIntent.SUGGEST_TIME
        return ScheduleIntent.NONE