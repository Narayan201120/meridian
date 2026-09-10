import { useTasksContext } from "../../src/context/TasksContext";
import TaskCardConnected from "../../src/components/TaskCardConnected";
import { ListScreen } from "../../src/components/ListScreen";

export default function InboxTab() {
  const { tasks, isLoading } = useTasksContext();
  return (
    <ListScreen
      eyebrow="INBOX"
      title="Inbox"
      body="New and reopened work lands here first."
      emptyTitle="Inbox is clear"
      emptyBody="New tasks and reopened work will land here first."
      isLoading={isLoading}
      tasks={tasks.filter((t) => t.status === "inbox")}
      renderCard={(t) => <TaskCardConnected key={t.id} task={t} />}
    />
  );
}
