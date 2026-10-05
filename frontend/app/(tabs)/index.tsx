import { useState } from "react";
import { StatusBar, Text, View } from "react-native";
import { Link } from "expo-router";
import { Reveal } from "../../src/components/ui/Reveal";
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
import { usePushNotifications } from "../../src/hooks/usePushNotifications";

import { tasksRuntime, type Task } from "../../src/lib/tasks";
import { useTaskMutations } from "../../src/hooks/useTaskMutations";
import { useTaskSync } from "../../src/hooks/useTaskSync";

// Home tab — dashboard: hero, mode/auth, capture, banners, pending
// reminders, and a due-now strip. Full lists live in their own tabs.
function DueNowStrip({ tasks, isLoading, renderCard }: { tasks: Task[]; isLoading: boolean; renderCard: (t: Task) => React.ReactNode }) {
  const due = tasks.filter((t) => t.status === "due_now");
  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="Needs attention" title="Due now" body="The most urgent work, inline. Everything else lives in its tab." />
      {isLoading ? (
        <Text className="text-bodytext dark:text-nightmuted text-[14px]">Loading tasks...</Text>
      ) : due.length === 0 ? (
        <View className="bg-sandbg dark:bg-nightcard rounded-2xl p-4 border border-sandborder dark:border-nightborder gap-1">
          <Text className="text-ink dark:text-nighttext font-bold">Nothing is due right now</Text>
          <Text className="text-sandtext dark:text-nightmuted text-[14px]">When scheduled work activates, it shows up here first.</Text>
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
  // Calendar gets its own notice slot. It used to share dispatchNotice, so a
  // calendar message ("Calendar synced — …" or "Finish connecting …")
  // rendered inside a green banner titled "Reminders", and a reminder notice
  // overwrote it and vice versa. setDispatchNotice is no longer passed down.
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const { calendarStatus, isSyncing, isConnecting, handleSyncCalendar, handleConnectCalendar } = useCalendarSync(authSession, setErrorMessage, setCalendarNotice);
  const { state: pushState, message: pushMessage, isBusy: isPushBusy, enable: enablePush, disable: disablePush } = usePushNotifications();
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
    setCalendarNotice(null);
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
          <Reveal once="home-hero">
            <Hero />
          </Reveal>
          <ModeStatus
            authSession={authSession}
            calendarStatus={calendarStatus}
            isSyncing={isSyncing}
            isConnecting={isConnecting}
            pushState={pushState}
            pushMessage={pushMessage}
            isPushBusy={isPushBusy}
            onEnablePush={() => void enablePush()}
            onDisablePush={() => void disablePush()}
            isSigningOut={isSigningOut}
            onRefresh={() => void loadTasks()}
            onSync={() => void handleSyncCalendar()}
            onConnect={() => void handleConnectCalendar()}
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

              {errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} /> : null}

              {dueNotice ? <StatusBanner variant="success" title="Due now" message={dueNotice} /> : null}

              {dispatchNotice ? <StatusBanner variant="success" title="Reminders" message={dispatchNotice} /> : null}

              {calendarNotice ? (
                <StatusBanner
                  // Only the sync producer reports a completed success. The
                  // "finish connecting" producer is an instruction to do
                  // something elsewhere, so it renders as info, never success.
                  // This sniffs the producer copy in useCalendarSync (owned
                  // elsewhere): if that copy changes, this must follow it.
                  variant={calendarNotice.startsWith("Calendar synced") ? "success" : "info"}
                  title="Calendar"
                  message={calendarNotice}
                />
              ) : null}

              <PendingRemindersCard pending={pendingReminders} onAcked={(id) => setPendingReminders((prev) => prev.filter((x) => x.id !== id))} onError={(m) => setErrorMessage(m)} />

              <Reveal once="home-due-now" delay={120}>
                <DueNowStrip
                  tasks={tasks}
                  isLoading={isLoading}
                  renderCard={renderTaskCard}
                />
              </Reveal>
            </>
          )}

          {tasksRuntime.isApiMode && authSession === null && errorMessage ? <StatusBanner variant="error" title="Current issue" message={errorMessage} /> : null}
        </PageShell>
    </>
  );
}

