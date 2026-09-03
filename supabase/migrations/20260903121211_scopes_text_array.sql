-- Align calendar_connections.scopes with ORM mapping (text[]).
-- Idempotent: only converts the column type when it is not already text[].

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'calendar_connections'
          and column_name = 'scopes'
          and udt_name <> '_text'
    ) then
        alter table public.calendar_connections
            alter column scopes type text[]
            using (
                case
                    when scopes is null then '{}'::text[]
                    when pg_typeof(scopes)::text in ('json', 'jsonb') then
                        case
                            when scopes::jsonb is null then '{}'::text[]
                            when jsonb_typeof(scopes::jsonb) <> 'array' then '{}'::text[]
                            else coalesce(
                                (select array_agg(elem) from jsonb_array_elements_text(scopes::jsonb) as elem),
                                '{}'::text[]
                            )
                        end
                    else scopes::text[]
                end
            );
    end if;
end
$$;

alter table public.calendar_connections alter column scopes set default '{}';
update public.calendar_connections set scopes = '{}' where scopes is null;
alter table public.calendar_connections alter column scopes set not null;
