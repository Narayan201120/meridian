import { ActivityIndicator, Text, View } from "react-native";
import { Chip } from "./ui/Chip";
import { Card } from "./ui/Card";
import { SectionHeader } from "./ui/SectionHeader";
import TaskCard from "./TaskCard";
import type { Task } from "../lib/tasks";

const filters = [
  { key: "all", label: "All" },
  { key: "inbox", label: "Inbox" },
  { key: "due_now", label: "Due now" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
] as const;

function getCount(tasks: any[], filter: string) {
  if (filter === "all") return tasks.length;
  return tasks.filter((t) => t.status === filter).length;
}

function getGroups(tasks: any[], active: string) {
  const base = [
    { key: "inbox", label: "Inbox", emptyTitle: "Inbox is clear", emptyBody: "New tasks and reopened work will land here first." },
    { key: "due_now", label: "Due now", emptyTitle: "Nothing is due right now", emptyBody: "When scheduled work activates, it moves here and asks for attention." },
    { key: "scheduled", label: "Scheduled", emptyTitle: "Nothing is scheduled", emptyBody: "This is where calendar-aware work will show up next." },
    { key: "completed", label: "Completed", emptyTitle: "Nothing completed yet", emptyBody: "Completed work will stay visible here until you archive it." },
  ];
  if (active !== "all") return base.filter((g) => g.key === active).map((g) => ({ ...g, tasks: tasks.filter((t) => t.status === g.key) }));
  return base.map((g) => ({ ...g, tasks: tasks.filter((t) => t.status === g.key) }));
}

export function TaskList({
  activeFilter,
  setActiveFilter,
  tasks = [],
  isLoading = false,
  renderCard,
}: {
  activeFilter: string;
  setActiveFilter: (k: any) => void;
  tasks?: Task[];
  isLoading?: boolean;
  renderCard?: (t: Task) => React.ReactNode;
}) {
  const groups = getGroups(tasks, activeFilter);
  const render = renderCard ?? ((t: Task) => <TaskCard key={t.id} task={t} />);

  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="TASK LIST" title="Shape the work" body="Meridian needs more than a raw list. Filter by task state, then work from a clearer execution view." />
      <View className="flex-row flex-wrap gap-2">
        {filters.map((f) => (
          <Chip key={f.key} label={f.label} count={getCount(tasks, f.key)} active={activeFilter === f.key} onPress={() => setActiveFilter(f.key)} />
        ))}
      </View>
      {isLoading ? (
        <View className="flex-row items-center gap-2 py-3">
          <ActivityIndicator size="small" color="#132A24" />
          <Text className="text-[#415255] text-[14px]">Loading tasks...</Text>
        </View>
      ) : null}
      {!isLoading && tasks.length === 0 ? (
        <View className="bg-[#F6EFE1] rounded-2xl p-4 border border-[#E2D8C3]">
          <Text className="text-[#1D2A2C] text-[16px] font-bold">No tasks yet</Text>
          <Text className="text-[#5B615D] text-[14px]">Add a task above to seed the first real workflow in the app.</Text>
        </View>
      ) : null}
      {!isLoading ? (
        <View className="gap-6">
          {groups.map((g) => (
            <View key={g.key} className="gap-3">
              <View className="flex-row justify-between items-center">
                <Text className="text-[#1D2A2C] text-[18px] font-bold">{g.label}</Text>
                <Text className="text-[#6A6258] text-[12px] font-extrabold uppercase">{g.tasks.length}</Text>
              </View>
              {g.tasks.length === 0 ? (
                <View className="bg-[#F6EFE1] rounded-2xl p-4 border border-[#E2D8C3] gap-1">
                  <Text className="text-[#1D2A2C] font-bold">{g.emptyTitle}</Text>
                  <Text className="text-[#5B615D] text-[14px]">{g.emptyBody}</Text>
                </View>
              ) : (
                <View className="gap-3">{g.tasks.map((t) => render(t))}</View>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
