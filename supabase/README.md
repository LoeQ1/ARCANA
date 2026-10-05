# Supabase setup

The game uses the existing Supabase project for both player saves and shared game content. Player saves stay in `player_state`; story and gameplay configuration live together in the singleton `game_content` row.

## Migrations

Apply each migration once in the existing Supabase project. In the Dashboard, open **SQL Editor**, create a query, paste the complete migration file, and run it:

1. `migrations/202610040001_player_state.sql` creates per-account player saves. This should already be installed for the running game.
2. `migrations/202610050001_game_content.sql` creates shared content storage and policies. All players can read game content; only the configured editor email (`leekh375@naver.com`) can insert or update it.

Never put a `service_role` or secret key in the browser. The browser uses only the publishable key, and the database enforces editor write access with Row Level Security.

## Publish the initial content

After the game-content migration succeeds:

1. Sign in to the game with the editor account and open **스토리 편집기**.
2. If the content table is empty, the editor loads the repository's default JSON and shows **Supabase 최초 저장 필요**.
3. Press **Supabase 저장** once. This inserts `gameplay.json` and `arrival.json` together as the initial published content.
4. Reload the game page. It now reads the shared content row from Supabase.

Subsequent editor saves update both documents together. An already-open game session keeps the content it loaded at startup; reload that game page to use the newly saved version. The editor uses a revision check and refuses to overwrite content changed by another editor session.

If the content table is empty or unavailable, the game temporarily loads its bundled JSON files and prints a visible notice. The editor can use the bundled JSON as a bootstrap, but it cannot publish until the migration is installed and its RLS policies are active.

## Player-state limits

The browser stores each player's state as JSONB in `player_state`, with row-level access limited to that authenticated account and conditional revision updates to prevent stale tabs from overwriting newer progress. This is a single-player prototype: never trust client-written state for leaderboards, trading, purchases with real value, or competitive play; those need server-side game rules and validation.
