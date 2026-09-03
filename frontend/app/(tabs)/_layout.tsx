import { Tabs } from "expo-router";
import { TasksProvider } from "../../src/context/TasksContext";

export default function TabsLayout() {
  return (
    <TasksProvider>
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
        <Tabs.Screen name="scheduled" options={{ title: "Scheduled" }} />
        <Tabs.Screen name="due_now" options={{ title: "Due now" }} />
        <Tabs.Screen name="completed" options={{ title: "Completed" }} />
      </Tabs>
    </TasksProvider>
  );
}
