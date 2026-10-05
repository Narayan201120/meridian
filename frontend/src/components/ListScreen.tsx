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
  loadFailed = false,
  renderCard,
}: {
  eyebrow: string;
  title: string;
  body: string;
  emptyTitle: string;
  emptyBody: string;
  isLoading: boolean;
  tasks: Task[];
  /**
   * Whether the last read failed. Without this the screen can only branch on
   * `tasks.length`, and an empty array produced by a 500 is indistinguishable
   * from a genuinely empty list, so a failed load rendered as a cheerful
   * "Inbox is clear".
   */
  loadFailed?: boolean;
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
        ) : loadFailed ? (
          // Say what happened. An empty-state card here would be a statement
          // about the user's data that nobody has actually made.
          <View className="bg-sandbg dark:bg-nightcard rounded-2xl p-6 border border-sandborder dark:border-nightborder gap-1">
            <Text className="text-ink dark:text-nighttext text-[16px] font-bold">Could not load {title.toLowerCase()}</Text>
            <Text className="text-sandtext dark:text-nightmuted text-[14px] leading-5">
              The last attempt failed, so this list may be out of date. Try again in a moment.
            </Text>
          </View>
        ) : tasks.length === 0 ? (
          <View className="bg-sandbg dark:bg-nightcard rounded-2xl p-6 border border-sandborder dark:border-nightborder gap-1">
            <Text className="text-ink dark:text-nighttext text-[16px] font-bold">{emptyTitle}</Text>
            <Text className="text-sandtext dark:text-nightmuted text-[14px] leading-5">{emptyBody}</Text>
          </View>
        ) : (
          <View className="gap-3">{tasks.map((t) => renderCard(t))}</View>
        )}
      </PageShell>
    </SafeAreaView>
  );
}
