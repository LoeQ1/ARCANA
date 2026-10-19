-- GM role assignment and hidden, server-authorized story reset for ARCANA.
create table if not exists public.arcana_user_roles (
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null check (role = 'gm'),
    assigned_by uuid references auth.users (id) on delete set null,
    assigned_at timestamptz not null default now(),
    primary key (user_id, role)
);

alter table public.arcana_user_roles enable row level security;
revoke all on public.arcana_user_roles from public, anon, authenticated;

create or replace function public.arcana_is_gm()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.arcana_user_roles r
         where r.user_id = auth.uid()
           and r.role = 'gm'
    );
$$;

revoke all on function public.arcana_is_gm() from public, anon;
grant execute on function public.arcana_is_gm() to authenticated;

create or replace function public.arcana_list_users_for_editor()
returns table (
    user_id uuid,
    email text,
    character_name text,
    created_at timestamptz,
    is_gm boolean,
    is_editor boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'leekh375@naver.com' then
        raise exception 'Editor permission required';
    end if;

    return query
    select u.id,
           u.email::text,
           coalesce(u.raw_user_meta_data ->> 'character_name', '')::text,
           u.created_at,
           exists (
               select 1 from public.arcana_user_roles r
                where r.user_id = u.id and r.role = 'gm'
           ),
           lower(coalesce(u.email, '')) = 'leekh375@naver.com'
      from auth.users u
     order by u.created_at desc;
end;
$$;

revoke all on function public.arcana_list_users_for_editor() from public, anon;
grant execute on function public.arcana_list_users_for_editor() to authenticated;

create or replace function public.arcana_set_user_gm(p_user_id uuid, p_is_gm boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'leekh375@naver.com' then
        raise exception 'Editor permission required';
    end if;
    if p_user_id is null then
        raise exception 'A user must be selected';
    end if;
    if exists (
        select 1 from auth.users u
         where u.id = p_user_id
           and lower(coalesce(u.email, '')) = 'leekh375@naver.com'
    ) then
        raise exception 'The editor account cannot be assigned as GM';
    end if;

    if p_is_gm then
        insert into public.arcana_user_roles (user_id, role, assigned_by, assigned_at)
        values (p_user_id, 'gm', auth.uid(), now())
        on conflict (user_id, role)
        do update set assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
    else
        delete from public.arcana_user_roles
         where user_id = p_user_id and role = 'gm';
    end if;
end;
$$;

revoke all on function public.arcana_set_user_gm(uuid, boolean) from public, anon;
grant execute on function public.arcana_set_user_gm(uuid, boolean) to authenticated;

create or replace function public.arcana_reset_story_progress()
returns table (new_state jsonb, new_revision bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    saved_state jsonb;
    current_story jsonb;
    start_node text;
    story_version integer;
    next_state jsonb;
    next_revision bigint;
begin
    if caller_id is null then
        raise exception 'Authentication required';
    end if;
    if not exists (
        select 1 from public.arcana_user_roles r
         where r.user_id = caller_id and r.role = 'gm'
    ) then
        raise exception 'GM permission required';
    end if;

    select gc.story
      into current_story
      from public.game_content gc
     where gc.id = 'main';
    if current_story is null then
        raise exception 'Published story content was not found';
    end if;

    start_node := current_story ->> 'startNode';
    story_version := nullif(current_story ->> 'version', '')::integer;
    if start_node is null or story_version is null
       or not ((current_story -> 'nodes') ? start_node) then
        raise exception 'Published story start node is invalid';
    end if;

    select ps.state
      into saved_state
      from public.player_state ps
     where ps.user_id = caller_id
     for update;
    if saved_state is null then
        raise exception 'Player state was not found';
    end if;

    -- Reset story and story-related progress only. Character and inventory progression is preserved.
    next_state := saved_state || jsonb_build_object(
        'story', jsonb_build_object(
            'currentNode', start_node,
            'contentVersion', story_version,
            'history', '[]'::jsonb,
            'appliedChoices', '[]'::jsonb
        ),
        'flags', '{}'::jsonb,
        'quests', '{}'::jsonb,
        'questProgress', '{}'::jsonb,
        'questSteps', '{}'::jsonb,
        'relations', '{}'::jsonb
    );

    update public.player_state ps
       set state = next_state,
           content_version = story_version,
           revision = ps.revision + 1,
           updated_at = now()
     where ps.user_id = caller_id
     returning ps.revision into next_revision;

    return query select next_state, next_revision;
end;
$$;

revoke all on function public.arcana_reset_story_progress() from public, anon;
grant execute on function public.arcana_reset_story_progress() to authenticated;
