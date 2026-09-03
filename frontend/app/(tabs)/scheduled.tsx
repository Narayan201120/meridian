import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTasksContext } from "../../src/context/TasksContext";
import TaskCard from "../../src/components/TaskCard";
export default function ScheduledTab() {
  const { tasks, isLoading } = useTasksContext();
  const list = tasks.filter((t) => t.status === "scheduled");
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Scheduled</Text>
        {isLoading ? <View style={styles.loading}><ActivityIndicator /><Text>Loading...</Text></View> : list.length === 0 ? <Text style={styles.empty}>Nothing scheduled — calendar-aware work will show up here.</Text> : <View style={styles.list}>{list.map((t) => <TaskCard key={t.id} task={t} />)}</View>}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: "#F3EBDD" }, container: { padding: 20, gap: 12 }, title: { fontSize: 24, fontWeight: "800", color: "#1D2A2C" }, loading: { flexDirection: "row", gap: 10, alignItems: "center" }, empty: { color: "#5B615D" }, list: { gap: 12 } });
