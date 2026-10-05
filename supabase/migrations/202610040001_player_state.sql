create table if not exists public.player_state (
    user_id uuid primary key references auth.users (id) on delete cascade,
    state jsonb not null,
    content_version integer not null default 1 check (content_version > 0),
    revision bigint not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.player_state enable row level security;
grant select, insert, update on public.player_state to authenticated;

drop policy if exists "Players can read their own state" on public.player_state;
drop policy if exists "Players can create their own state" on public.player_state;
drop policy if exists "Players can update their own state" on public.player_state;

create policy "Players can read their own state"
    on public.player_state for select to authenticated
    using ((select auth.uid()) = user_id);

create policy "Players can create their own state"
    on public.player_state for insert to authenticated
    with check ((select auth.uid()) = user_id);

create policy "Players can update their own state"
    on public.player_state for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create or replace function public.save_player_state(p_state jsonb, p_content_version integer, p_expected_revision bigint)
returns table (new_revision bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
begin
    if caller_id is null then
        raise exception 'Authentication required';
    end if;
    if p_content_version < 1 or p_expected_revision < 0 then
        raise exception 'Invalid version or revision';
    end if;

    if p_expected_revision = 0 then
        insert into public.player_state (user_id, state, content_version, revision)
        values (caller_id, p_state, p_content_version, 1)
        on conflict (user_id) do nothing;
        if not found then raise exception 'Player state already exists'; end if;
        return query select 1::bigint;
    end if;

    update public.player_state
       set state = p_state,
           content_version = p_content_version,
           revision = revision + 1,
           updated_at = now()
     where user_id = caller_id and revision = p_expected_revision;
    if not found then raise exception 'Player state changed in another session; reload before saving'; end if;
    return query select p_expected_revision + 1;
end;
$$;

revoke all on function public.save_player_state(jsonb, integer, bigint) from public;
grant execute on function public.save_player_state(jsonb, integer, bigint) to authenticated;
