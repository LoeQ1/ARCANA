create table if not exists public.game_content (
    id text primary key check (id = 'main'),
    gameplay jsonb not null check (jsonb_typeof(gameplay) = 'object'),
    story jsonb not null check (jsonb_typeof(story) = 'object'),
    revision bigint not null default 1 check (revision > 0),
    updated_by uuid references auth.users (id) on delete set null,
    updated_at timestamptz not null default now()
);

alter table public.game_content enable row level security;
revoke all on public.game_content from public;
revoke all on public.game_content from anon, authenticated;
grant select on public.game_content to anon, authenticated;
grant insert, update on public.game_content to authenticated;

drop policy if exists "Game content is readable by players" on public.game_content;
drop policy if exists "Only the editor can create game content" on public.game_content;
drop policy if exists "Only the editor can update game content" on public.game_content;

create policy "Game content is readable by players"
    on public.game_content for select to anon, authenticated
    using (true);

create policy "Only the editor can create game content"
    on public.game_content for insert to authenticated
    with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'leekh375@naver.com');

create policy "Only the editor can update game content"
    on public.game_content for update to authenticated
    using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'leekh375@naver.com')
    with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'leekh375@naver.com');
