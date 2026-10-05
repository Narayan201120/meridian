import { useTasksContext } from "../../src/context/TasksContext";
import TaskCardConnected from "../../src/components/TaskCardConnected";
import { ListScreen } from "../../src/components/ListScreen";

export default function InboxTab() {
  const { tasks, isLoading, errorMessage } = useTasksContext();
  return (
    <ListScreen
      eyebrow="Inbox"
      title="Inbox"
      body="New and reopened work lands here first."
      emptyTitle="Inbox is clear"
      emptyBody="New tasks and reopened work will land here first."
      isLoading={isLoading}
      loadFailed={errorMessage !== null}
      tasks={tasks.filter((t) => t.status === "inbox")}
      renderCard={(t) => <TaskCardConnected key={t.id} task={t} />}
    />
  );
}
