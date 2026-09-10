import { useTasksContext } from "../../src/context/TasksContext";
import TaskCardConnected from "../../src/components/TaskCardConnected";
import { ListScreen } from "../../src/components/ListScreen";

export default function CompletedTab() {
  const { tasks, isLoading } = useTasksContext();
  return (
    <ListScreen
      eyebrow="DONE"
      title="Completed"
      body="Finished work, kept visible until archived."
      emptyTitle="Nothing completed yet"
      emptyBody="Completed work will stay visible here until you archive it."
      isLoading={isLoading}
      tasks={tasks.filter((t) => t.status === "completed")}
      renderCard={(t) => <TaskCardConnected key={t.id} task={t} />}
    />
  );
}
