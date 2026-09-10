import { useState } from "react";
import { StatusBar, Text, View } from "react-native";
import { Link } from "expo-router";
import { Card } from "../../src/components/ui/Card";
import { SectionHeader } from "../../src/components/ui/SectionHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { StatusBanner } from "../../src/components/ui/StatusBanner";
import { CreateTaskForm } from "../../src/components/CreateTaskForm";
import { VoiceCaptureCard } from "../../src/components/VoiceCaptureCard";
import { Hero } from "../../src/components/Hero";
import { ModeStatus } from "../../src/components/ModeStatus";
import { AuthCard } from "../../src/components/AuthCard";
import { PendingRemindersCard } from "../../src/components/PendingRemindersCard";
import TaskCardEditor from "../../src/components/TaskCardEditor";
import { useAuth } from "../../src/hooks/useAuth";
import { useCalendarSync } from "../../src/hooks/useCalendarSync";

import { tasksRuntime, type Task } from "../../src/lib/tasks";
import { useTaskMutations } from "../../src/hooks/useTaskMutations";
import { useTaskSync } from "../../src/hooks/useTaskSync";

// Home tab — dashboard: hero, mode/auth, capture, banners, pending
// reminders, and a due-now strip. Full lists live in their own tabs.
function DueNowStrip({ tasks, isLoading, renderCard }: { tasks: Task[]; isLoading: boolean; renderCard: (t: Task) => React.ReactNode }) {
  const due = tasks.filter((t) => t.status === "due_now");
  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="NEEDS ATTENTION" title="Due now" body="The most urgent work, inline. Everything else lives in its tab." />
      {isLoading ? (
        <Text className="text-bodytext text-[14px]">Loading tasks...</Text>
      ) : due.length === 0 ? (
        <View className="bg-sandbg rounded-2xl p-4 border border-sandborder gap-1">
          <Text className="text-ink font-bold">Nothing is due right now</Text>
          <Text className="text-sandtext text-[14px]">When scheduled work activates, it shows up here first.</Text>
        </View>
      ) : (
        <View className="gap-3">{due.map((t) => renderCard(t))}</View>
      )}
      <Link href="/(tabs)/due_now" className="text-[13px] font-bold text-primary">
        Open Due now tab →
      </Link>
    </Card>
  );
}

export default function HomeTab() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { authSession, authEmail, setAuthEmail, authPassword, setAuthPassword, isSigningIn, isSigningOut, handleSignIn, handleSignOut } = useAuth(setErrorMessage);
  const { tasks, setTasks, isLoading, dueNotice, remindersByTask, pendingReminders, dispatchNotice, setDispatchNotice, setPendingReminders, loadTasks, refreshRemindersForTask, replaceTask } = useTaskSync(authSession, setErrorMessage);
  const { calendarStatus, isSyncing, handleSyncCalendar } = useCalendarSync(authSession, setErrorMessage, setDispatchNotice);
  const {
    activeTaskId, activeTaskAction, scheduleEditorTaskId, scheduleEditorValue, setScheduleEditorValue,
    taskEditorTaskId, taskEditorTitle, taskEditorNotes, taskEditorPriority, taskEditorDuration,
    setTaskEditorTitle, setTaskEditorNotes, setTaskEditorPriority, setTaskEditorDuration,
    suggestionsByTask, handleToggleTaskStatus, handleDeleteTask, handleOpenTaskEditor, closeTaskEditor,
    handleSaveTaskDetails, handleOpenScheduleEditor, closeScheduleEditor, handleSaveSchedule, handleUnscheduleTask,
    handleSuggestBlocks, handleApplySuggestion,
  } = useTaskMutations({
    replaceTask,
    removeTask: (id) => setTasks((prev) => prev.filter((x) => x.id !== id)),
    refreshReminders: (id) => void refreshRemindersForTask(id),
    notify: setErrorMessage,
    calendarStatus,
    activeFilter: "all",
    onFilterChange: () => {},
  });

  async function handleSignOutAndClear() {
    await handleSignOut();
    setTasks([]);
  }

  function renderTaskCard(task: Task) {
    return (
      <TaskCardEditor
        key={task.id}
        task={task}
        isBusy={activeTaskId === task.id}
        activeAction={activeTaskId === task.id ? activeTaskAction : null}
        isEditingSchedule={scheduleEditorTaskId === task.id}
        isEditingTask={taskEditorTaskId === task.id}
        scheduleEditorValue={scheduleEditorValue}
        taskEditorTitle={taskEditorTitle}
        taskEditorNotes={taskEditorNotes}
        taskEditorPriority={taskEditorPriority}
        taskEditorDuration={taskEditorDuration}
        suggestions={suggestionsByTask[task.id] ?? []}
        reminders={remindersByTask[task.id] ?? []}
        callbacks={{
          onOpenTaskEditor: () => handleOpenTaskEditor(task),
          onCloseTaskEditor: closeTaskEditor,
          onSaveTaskDetails: () => void handleSaveTaskDetails(task),
          onOpenScheduleEditor: () => handleOpenScheduleEditor(task),
          onCloseScheduleEditor: closeScheduleEditor,
          onSaveSchedule: () => void handleSaveSchedule(task),
          onUnschedule: () => void handleUnscheduleTask(task),
          onToggleStatus: () => void handleToggleTaskStatus(task),
          onDelete: () => void handleDeleteTask(task.id),
          onSuggest: () => void handleSuggestBlocks(task),
          onApplySuggestion: (block) => void handleApplySuggestion(task, block),
          setScheduleEditorValue,
          setTaskEditorTitle,
          setTaskEditorNotes,
          setTaskEditorPriority,
          setTaskEditorDuration,
        }}
      />
    );
  }

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <PageShell>
          <Hero />
          <ModeStatus
            authSession={authSession}
            calendarStatus={calendarStatus}
            isSyncing={isSyncing}
            isSigningOut={isSigningOut}
            onRefresh={() => void loadTasks()}
            onSync={() => void handleSyncCalendar()}
            onSignOut={() => void handleSignOutAndClear()}
          />

          {tasksRuntime.isApiMode && authSession === null ? (
            <AuthCard
              authEmail={authEmail}
              setAuthEmail={setAuthEmail}
              authPassword={authPassword}
              setAuthPassword={setAuthPassword}
              isSigningIn={isSigningIn}
              onSignIn={() => void handleSignIn()}
            />

          ) : (
            <>
              <CreateTaskForm />
              <VoiceCaptureCard />

              {errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} actionLabel="Retry" onAction={() => void loadTasks()} /> : null}

              {dueNotice ? <StatusBanner variant="success" title="Due now" message={dueNotice} /> : null}

              {dispatchNotice ? <StatusBanner variant="success" title="Reminders" message={dispatchNotice} /> : null}

              <PendingRemindersCard pending={pendingReminders} onAcked={(id) => setPendingReminders((prev) => prev.filter((x) => x.id !== id))} onError={(m) => setErrorMessage(m)} />

              <DueNowStrip
                tasks={tasks}
                isLoading={isLoading}
                renderCard={renderTaskCard}
              />
            </>
          )}

          {tasksRuntime.isApiMode && authSession === null && errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} /> : null}
        </PageShell>
    </>
  );
}
