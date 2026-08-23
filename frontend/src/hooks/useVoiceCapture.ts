import { useState } from "react";
import { captureVoice } from "../lib/tasks";

export function useVoiceCapture() {
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isVoiceCapturing, setIsVoiceCapturing] = useState(false);
  const [voiceResult, setVoiceResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleVoiceCapture() {
    if (!voiceTranscript.trim()) {
      setErrorMessage("Add a voice transcript before capturing.");
      return;
    }
    setIsVoiceCapturing(true);
    setErrorMessage(null);
    setVoiceResult(null);
    try {
      const res = await captureVoice(voiceTranscript, true);
      setVoiceResult(`Captured "${res.suggestion.title}"` + (res.task_id ? ` → task ${res.task_id.slice(0, 8)}` : ""));
      setVoiceTranscript("");
    } catch (e: any) {
      setErrorMessage(e?.message ?? String(e));
    } finally {
      setIsVoiceCapturing(false);
    }
  }

  return { voiceTranscript, setVoiceTranscript, isVoiceCapturing, voiceResult, errorMessage, handleVoiceCapture };
}
