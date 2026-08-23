import { Text } from "react-native";
import { Card } from "./ui/Card";
import { TextArea } from "./ui/InputField";
import { Button } from "./ui/Button";
import { SectionHeader } from "./ui/SectionHeader";
import { StatusBanner } from "./ui/StatusBanner";
import { useVoiceCapture } from "../hooks/useVoiceCapture";

export function VoiceCaptureCard() {
  const { voiceTranscript, setVoiceTranscript, isVoiceCapturing, voiceResult, errorMessage, handleVoiceCapture } = useVoiceCapture();
  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="VOICE CAPTURE" title="Speak it, keep it" body="Paste a transcript (future: mic) — it will be structured and saved as a voice task. Never auto-writes calendar." />
      <TextArea
        label="Voice transcript"
        placeholder="Voice transcript (e.g., Urgent: record demo video, needs 30 minutes)"
        value={voiceTranscript}
        onChangeText={setVoiceTranscript}
      />
      <Button variant="primary" size="md" loading={isVoiceCapturing} onPress={handleVoiceCapture}>
        {isVoiceCapturing ? "Capturing voice..." : "Capture voice → Create task"}
      </Button>
      {voiceResult ? <Text className="text-[12px] font-semibold text-[#27443E]">{voiceResult}</Text> : null}
      {errorMessage ? <StatusBanner variant="error" message={errorMessage} /> : null}
    </Card>
  );
}
