import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PageShell } from "./ui/PageShell";
import { SectionHeader } from "./ui/SectionHeader";
import type { Task } from "../lib/tasks";

export function ListScreen({
  eyebrow,
  title,
  body,
  emptyTitle,
  emptyBody,
  isLoading,
  tasks,
  renderCard,
}: {
  eyebrow: string;
  title: string;
  body: string;
  emptyTitle: string;
  emptyBody: string;
  isLoading: boolean;
  tasks: Task[];
  renderCard: (t: Task) => React.ReactNode;
}) {
  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <PageShell>
        <SectionHeader eyebrow={eyebrow} title={title} body={body} />
        {isLoading ? (
          <View className="gap-3">
            <View className="flex-row items-center gap-2 py-1">
              <ActivityIndicator size="small" color="#09261E" />
              <Text className="text-bodytext text-[14px]">Loading tasks...</Text>
            </View>
            {[0, 1, 2].map((i) => (
              <View key={i} className="rounded-2xl bg-cardsurf border border-borderfaint p-4 gap-2">
                <View className="h-4 rounded-full bg-borderfaint w-3/4" />
                <View className="h-3 rounded-full bg-borderfaint w-1/2" />
              </View>
            ))}
          </View>
        ) : tasks.length === 0 ? (
          <View className="bg-sandbg rounded-2xl p-6 border border-sandborder gap-1">
            <Text className="text-ink text-[16px] font-bold">{emptyTitle}</Text>
            <Text className="text-sandtext text-[14px] leading-5">{emptyBody}</Text>
          </View>
        ) : (
          <View className="gap-3">{tasks.map((t) => renderCard(t))}</View>
        )}
      </PageShell>
    </SafeAreaView>
  );
}
