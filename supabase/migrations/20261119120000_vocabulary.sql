-- Vocabulary: minimal (id, level, english, bg).
-- Idempotent and safe on a database that already ran the earlier (audio) draft migration:
-- that draft's empty `vocabulary` table, enum and trigger function are removed, and the
-- original `a1_words` table is renamed to `vocabulary` with its data kept.
-- (The unused 'audio' storage bucket is removed through the Storage API, not SQL.)

do $$
begin
  if to_regclass('public.a1_words') is not null then
    drop table if exists public.vocabulary cascade;   -- discard empty draft table
    alter table public.a1_words rename to vocabulary;
  end if;
end $$;

drop type if exists public.cefr_level;
drop function if exists public.set_updated_at() cascade;

create table if not exists public.vocabulary (
  id      bigint generated always as identity primary key,
  level   text not null default 'A1',
  english text not null,
  bg      text not null
);

alter table public.vocabulary add column if not exists level text not null default 'A1';

-- Tidy stray whitespace/newlines in existing rows (e.g. "apple\n").
update public.vocabulary set english = btrim(english), bg = btrim(bg);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vocabulary_level_check') then
    alter table public.vocabulary
      add constraint vocabulary_level_check check (level in ('A1', 'A2', 'B1'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vocabulary_level_english_key') then
    alter table public.vocabulary
      add constraint vocabulary_level_english_key unique (level, english);
  end if;
end $$;

-- The (level, english) unique constraint also indexes level lookups.

-- RLS: public read; writes only via the service role (bypasses RLS).
alter table public.vocabulary enable row level security;
drop policy if exists "Vocabulary is publicly readable" on public.vocabulary;
drop policy if exists "Enable read access for all users" on public.vocabulary;
create policy "Vocabulary is publicly readable"
  on public.vocabulary for select
  to anon, authenticated
  using (true);
