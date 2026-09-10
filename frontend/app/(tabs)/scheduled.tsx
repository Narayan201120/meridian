import { useTasksContext } from "../../src/context/TasksContext";
import TaskCardConnected from "../../src/components/TaskCardConnected";
import { ListScreen } from "../../src/components/ListScreen";

export default function ScheduledTab() {
  const { tasks, isLoading } = useTasksContext();
  return (
    <ListScreen
      eyebrow="PLANNED"
      title="Scheduled"
      body="Calendar-aware work, ordered by activation time."
      emptyTitle="Nothing scheduled"
      emptyBody="This is where calendar-aware work will show up next."
      isLoading={isLoading}
      tasks={tasks.filter((t) => t.status === "scheduled")}
      renderCard={(t) => <TaskCardConnected key={t.id} task={t} />}
    />
  );
}
