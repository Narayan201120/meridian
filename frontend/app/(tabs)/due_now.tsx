import { useTasksContext } from "../../src/context/TasksContext";
import TaskCardConnected from "../../src/components/TaskCardConnected";
import { ListScreen } from "../../src/components/ListScreen";

export default function DueNowTab() {
  const { tasks, isLoading } = useTasksContext();
  return (
    <ListScreen
      eyebrow="NEEDS ATTENTION"
      title="Due now"
      body="Activated work that needs a decision right now."
      emptyTitle="Nothing is due right now"
      emptyBody="When scheduled work activates, it moves here and asks for attention."
      isLoading={isLoading}
      tasks={tasks.filter((t) => t.status === "due_now")}
      renderCard={(t) => <TaskCardConnected key={t.id} task={t} />}
    />
  );
}
