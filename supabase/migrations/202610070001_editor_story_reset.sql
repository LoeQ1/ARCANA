-- Allow the configured editor and assigned GMs to reset their own story progress.
create or replace function public.arcana_reset_story_progress()
returns table (new_state jsonb, new_revision bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
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
    if caller_email <> 'leekh375@naver.com'
       and not exists (
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
