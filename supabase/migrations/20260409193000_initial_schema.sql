create extension if not exists pgcrypto;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'task_status') then
        create type public.task_status as enum ('inbox', 'scheduled', 'completed', 'archived');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'task_priority') then
        create type public.task_priority as enum ('low', 'medium', 'high');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'task_source') then
        create type public.task_source as enum ('manual_text', 'voice', 'calendar_suggestion');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'schedule_intent') then
        create type public.schedule_intent as enum ('none', 'suggest_time', 'user_requested_block');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'device_platform') then
        create type public.device_platform as enum ('ios', 'android', 'web');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'voice_capture_status') then
        create type public.voice_capture_status as enum (
            'pending_upload',
            'uploaded',
            'transcribed',
            'failed',
            'discarded'
        );
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'calendar_provider') then
        create type public.calendar_provider as enum ('google', 'outlook');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'calendar_connection_status') then
        create type public.calendar_connection_status as enum ('active', 'revoked', 'error');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'task_calendar_block_status') then
        create type public.task_calendar_block_status as enum (
            'suggested',
            'pending_write',
            'confirmed',
            'write_failed',
            'canceled'
        );
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'reminder_type') then
        create type public.reminder_type as enum ('due_date', 'scheduled_block');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'reminder_status') then
        create type public.reminder_status as enum ('pending', 'scheduled', 'sent', 'failed', 'canceled');
    end if;
end $$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'notification_delivery_status') then
        create type public.notification_delivery_status as enum (
            'pending',
            'sent',
            'failed',
            'acknowledged'
        );
    end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    timezone text not null default 'UTC',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id)
    values (new.id)
    on conflict (id) do nothing;

    return new;
end;
$$;

create table if not exists public.devices (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    platform public.device_platform not null,
    device_name text,
    push_token text,
    last_seen_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, push_token)
);

create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    title text not null,
    notes text,
    status public.task_status not null default 'inbox',
    priority public.task_priority not null default 'medium',
    due_at timestamptz,
    estimated_duration_minutes integer,
    source public.task_source not null default 'manual_text',
    schedule_intent public.schedule_intent not null default 'none',
    parsing_confidence numeric(5,4),
    ai_metadata jsonb not null default '{}'::jsonb,
    client_created_at timestamptz,
    completed_at timestamptz,
    archived_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (estimated_duration_minutes is null or estimated_duration_minutes > 0),
    check (parsing_confidence is null or (parsing_confidence >= 0 and parsing_confidence <= 1))
);

create table if not exists public.task_mutation_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    task_id uuid not null references public.tasks (id) on delete cascade,
    source_device_id uuid references public.devices (id) on delete set null,
    client_mutation_id uuid not null,
    mutation_kind text not null,
    mutation_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    applied_at timestamptz,
    unique (user_id, client_mutation_id)
);

create table if not exists public.voice_captures (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    task_id uuid references public.tasks (id) on delete set null,
    status public.voice_capture_status not null default 'pending_upload',
    storage_path text,
    transcript text,
    transcript_provider text,
    transcript_confidence numeric(5,4),
    retention_expires_at timestamptz,
    uploaded_at timestamptz,
    transcribed_at timestamptz,
    discarded_at timestamptz,
    last_error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (transcript_confidence is null or (transcript_confidence >= 0 and transcript_confidence <= 1))
);

create table if not exists public.calendar_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    provider public.calendar_provider not null,
    status public.calendar_connection_status not null default 'active',
    provider_account_id text not null,
    provider_email text,
    access_token_ciphertext text,
    refresh_token_ciphertext text,
    token_expires_at timestamptz,
    scopes text[] not null default '{}',
    last_synced_at timestamptz,
    last_error_at timestamptz,
    last_error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, provider, provider_account_id)
);

create table if not exists public.calendar_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    calendar_connection_id uuid not null references public.calendar_connections (id) on delete cascade,
    external_event_id text not null,
    title text,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    is_all_day boolean not null default false,
    status text not null default 'confirmed',
    raw_payload jsonb not null default '{}'::jsonb,
    last_synced_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (calendar_connection_id, external_event_id),
    check (ends_at > starts_at)
);

create table if not exists public.task_calendar_blocks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    task_id uuid not null references public.tasks (id) on delete cascade,
    calendar_connection_id uuid not null references public.calendar_connections (id) on delete cascade,
    calendar_event_id uuid references public.calendar_events (id) on delete set null,
    status public.task_calendar_block_status not null default 'suggested',
    suggested_start_at timestamptz not null,
    suggested_end_at timestamptz not null,
    suggestion_reason jsonb not null default '{}'::jsonb,
    approved_at timestamptz,
    write_requested_at timestamptz,
    write_completed_at timestamptz,
    last_error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (suggested_end_at > suggested_start_at)
);

create table if not exists public.reminders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    task_id uuid references public.tasks (id) on delete cascade,
    task_calendar_block_id uuid references public.task_calendar_blocks (id) on delete cascade,
    type public.reminder_type not null,
    scheduled_for timestamptz not null,
    status public.reminder_status not null default 'pending',
    delivery_channel text not null default 'push',
    local_only boolean not null default false,
    sent_at timestamptz,
    last_error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (task_id is not null or task_calendar_block_id is not null)
);

create table if not exists public.notification_deliveries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    reminder_id uuid not null references public.reminders (id) on delete cascade,
    device_id uuid references public.devices (id) on delete set null,
    provider text not null default 'fcm',
    status public.notification_delivery_status not null default 'pending',
    provider_message_id text,
    attempted_at timestamptz,
    delivered_at timestamptz,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_devices_user_id on public.devices (user_id);
create index if not exists idx_tasks_user_status_due_at on public.tasks (user_id, status, due_at);
create index if not exists idx_tasks_user_updated_at on public.tasks (user_id, updated_at desc);
create index if not exists idx_task_mutation_log_task_id_created_at on public.task_mutation_log (task_id, created_at desc);
create index if not exists idx_voice_captures_user_status on public.voice_captures (user_id, status);
create index if not exists idx_calendar_connections_user_provider on public.calendar_connections (user_id, provider);
create index if not exists idx_calendar_events_user_starts_at on public.calendar_events (user_id, starts_at);
create index if not exists idx_task_calendar_blocks_user_status_start on public.task_calendar_blocks (user_id, status, suggested_start_at);
create index if not exists idx_reminders_user_status_scheduled_for on public.reminders (user_id, status, scheduled_for);
create index if not exists idx_notification_deliveries_reminder_id on public.notification_deliveries (reminder_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_devices_updated_at on public.devices;
create trigger set_devices_updated_at
before update on public.devices
for each row
execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

drop trigger if exists set_voice_captures_updated_at on public.voice_captures;
create trigger set_voice_captures_updated_at
before update on public.voice_captures
for each row
execute function public.set_updated_at();

drop trigger if exists set_calendar_connections_updated_at on public.calendar_connections;
create trigger set_calendar_connections_updated_at
before update on public.calendar_connections
for each row
execute function public.set_updated_at();

drop trigger if exists set_calendar_events_updated_at on public.calendar_events;
create trigger set_calendar_events_updated_at
before update on public.calendar_events
for each row
execute function public.set_updated_at();

drop trigger if exists set_task_calendar_blocks_updated_at on public.task_calendar_blocks;
create trigger set_task_calendar_blocks_updated_at
before update on public.task_calendar_blocks
for each row
execute function public.set_updated_at();

drop trigger if exists set_reminders_updated_at on public.reminders;
create trigger set_reminders_updated_at
before update on public.reminders
for each row
execute function public.set_updated_at();

drop trigger if exists set_notification_deliveries_updated_at on public.notification_deliveries;
create trigger set_notification_deliveries_updated_at
before update on public.notification_deliveries
for each row
execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.tasks enable row level security;
alter table public.task_mutation_log enable row level security;
alter table public.voice_captures enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_events enable row level security;
alter table public.task_calendar_blocks enable row level security;
alter table public.reminders enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists devices_select_own on public.devices;
create policy devices_select_own
on public.devices
for select
using (user_id = auth.uid());

drop policy if exists devices_insert_own on public.devices;
create policy devices_insert_own
on public.devices
for insert
with check (user_id = auth.uid());

drop policy if exists devices_update_own on public.devices;
create policy devices_update_own
on public.devices
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists devices_delete_own on public.devices;
create policy devices_delete_own
on public.devices
for delete
using (user_id = auth.uid());

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own
on public.tasks
for select
using (user_id = auth.uid());

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own
on public.tasks
for insert
with check (user_id = auth.uid());

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own
on public.tasks
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own
on public.tasks
for delete
using (user_id = auth.uid());

drop policy if exists task_mutation_log_select_own on public.task_mutation_log;
create policy task_mutation_log_select_own
on public.task_mutation_log
for select
using (user_id = auth.uid());

drop policy if exists task_mutation_log_insert_own on public.task_mutation_log;
create policy task_mutation_log_insert_own
on public.task_mutation_log
for insert
with check (user_id = auth.uid());

drop policy if exists task_mutation_log_delete_own on public.task_mutation_log;
create policy task_mutation_log_delete_own
on public.task_mutation_log
for delete
using (user_id = auth.uid());

drop policy if exists voice_captures_select_own on public.voice_captures;
create policy voice_captures_select_own
on public.voice_captures
for select
using (user_id = auth.uid());

drop policy if exists voice_captures_insert_own on public.voice_captures;
create policy voice_captures_insert_own
on public.voice_captures
for insert
with check (user_id = auth.uid());

drop policy if exists voice_captures_update_own on public.voice_captures;
create policy voice_captures_update_own
on public.voice_captures
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists voice_captures_delete_own on public.voice_captures;
create policy voice_captures_delete_own
on public.voice_captures
for delete
using (user_id = auth.uid());

drop policy if exists calendar_connections_select_own on public.calendar_connections;
create policy calendar_connections_select_own
on public.calendar_connections
for select
using (user_id = auth.uid());

drop policy if exists calendar_connections_insert_own on public.calendar_connections;
create policy calendar_connections_insert_own
on public.calendar_connections
for insert
with check (user_id = auth.uid());

drop policy if exists calendar_connections_update_own on public.calendar_connections;
create policy calendar_connections_update_own
on public.calendar_connections
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists calendar_connections_delete_own on public.calendar_connections;
create policy calendar_connections_delete_own
on public.calendar_connections
for delete
using (user_id = auth.uid());

drop policy if exists calendar_events_select_own on public.calendar_events;
create policy calendar_events_select_own
on public.calendar_events
for select
using (user_id = auth.uid());

drop policy if exists calendar_events_insert_own on public.calendar_events;
create policy calendar_events_insert_own
on public.calendar_events
for insert
with check (user_id = auth.uid());

drop policy if exists calendar_events_update_own on public.calendar_events;
create policy calendar_events_update_own
on public.calendar_events
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists calendar_events_delete_own on public.calendar_events;
create policy calendar_events_delete_own
on public.calendar_events
for delete
using (user_id = auth.uid());

drop policy if exists task_calendar_blocks_select_own on public.task_calendar_blocks;
create policy task_calendar_blocks_select_own
on public.task_calendar_blocks
for select
using (user_id = auth.uid());

drop policy if exists task_calendar_blocks_insert_own on public.task_calendar_blocks;
create policy task_calendar_blocks_insert_own
on public.task_calendar_blocks
for insert
with check (user_id = auth.uid());

drop policy if exists task_calendar_blocks_update_own on public.task_calendar_blocks;
create policy task_calendar_blocks_update_own
on public.task_calendar_blocks
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists task_calendar_blocks_delete_own on public.task_calendar_blocks;
create policy task_calendar_blocks_delete_own
on public.task_calendar_blocks
for delete
using (user_id = auth.uid());

drop policy if exists reminders_select_own on public.reminders;
create policy reminders_select_own
on public.reminders
for select
using (user_id = auth.uid());

drop policy if exists reminders_insert_own on public.reminders;
create policy reminders_insert_own
on public.reminders
for insert
with check (user_id = auth.uid());

drop policy if exists reminders_update_own on public.reminders;
create policy reminders_update_own
on public.reminders
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists reminders_delete_own on public.reminders;
create policy reminders_delete_own
on public.reminders
for delete
using (user_id = auth.uid());

drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own
on public.notification_deliveries
for select
using (user_id = auth.uid());

drop policy if exists notification_deliveries_insert_own on public.notification_deliveries;
create policy notification_deliveries_insert_own
on public.notification_deliveries
for insert
with check (user_id = auth.uid());

drop policy if exists notification_deliveries_update_own on public.notification_deliveries;
create policy notification_deliveries_update_own
on public.notification_deliveries
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists notification_deliveries_delete_own on public.notification_deliveries;
create policy notification_deliveries_delete_own
on public.notification_deliveries
for delete
using (user_id = auth.uid());
