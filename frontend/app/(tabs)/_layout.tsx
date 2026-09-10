import { Tabs } from "expo-router";
import { BellRing, CalendarClock, CircleCheck, House, Inbox } from "lucide-react-native";
import { TasksProvider } from "../../src/context/TasksContext";

function tabIcon(Icon: typeof House) {
  return ({ color, size }: { color: string; size: number }) => <Icon size={size} color={color} strokeWidth={1.5} />;
}

export default function TabsLayout() {
  return (
    <TasksProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#09261E",
          tabBarInactiveTintColor: "#64748B",
          tabBarStyle: { backgroundColor: "#FFFDF8", borderTopColor: "#E2E8F0" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon(House) }} />
        <Tabs.Screen name="inbox" options={{ title: "Inbox", tabBarIcon: tabIcon(Inbox) }} />
        <Tabs.Screen name="scheduled" options={{ title: "Scheduled", tabBarIcon: tabIcon(CalendarClock) }} />
        <Tabs.Screen name="due_now" options={{ title: "Due now", tabBarIcon: tabIcon(BellRing) }} />
        <Tabs.Screen name="completed" options={{ title: "Completed", tabBarIcon: tabIcon(CircleCheck) }} />
      </Tabs>
    </TasksProvider>
  );
}
