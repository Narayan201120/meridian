import { Text } from "react-native";
import { Card } from "./ui/Card";

export function Hero() {
  return (
    <Card variant="hero">
      <Text className="text-kicker text-[13px] font-bold tracking-[1.4px] uppercase mb-2">Meridian</Text>
      <Text className="text-creamtext text-[32px] leading-[38px] font-extrabold mb-3">Capture a task, then give it somewhere real to go.</Text>
      <Text className="text-herosub text-[16px] leading-6">Capture fast, schedule around your calendar, and get reminded at the right moment.</Text>
    </Card>
  );
}
