import { Text } from "react-native";
import { Card } from "./ui/Card";

export function Hero() {
  return (
    <Card variant="hero">
      <Text className="text-[#DAB785] text-[13px] font-bold tracking-[1.4px] uppercase mb-2">Meridian</Text>
      <Text className="text-[#FFF8EE] text-[32px] leading-[38px] font-extrabold mb-3">Capture a task, then give it somewhere real to go.</Text>
      <Text className="text-[#D9E3DC] text-[16px] leading-6">This is the first live task flow. In demo mode it runs locally. In API mode it talks to the FastAPI backend with a real Supabase bearer token.</Text>
    </Card>
  );
}
