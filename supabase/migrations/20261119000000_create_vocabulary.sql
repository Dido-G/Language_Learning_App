-- Vocabulary table: CEFR-levelled English <-> Bulgarian words/phrases with audio metadata.

create type public.cefr_level as enum ('A1', 'A2', 'B1');

create table public.vocabulary (
  id               bigint generated always as identity primary key,
  level            public.cefr_level not null,
  english          text not null check (length(btrim(english)) > 0),
  bulgarian        text not null check (length(btrim(bulgarian)) > 0),
  part_of_speech   text not null default '',   -- noun, verb, adj, adv, phrase, ...
  notes            text,                        -- usage notes, gender, examples
  -- Audio / pronunciation metadata (files live in the public 'audio' storage bucket)
  english_audio_path   text,                    -- e.g. 'en/a1/hello.mp3'
  bulgarian_audio_path text,                    -- e.g. 'bg/a1/hello.mp3'
  english_ipa          text,
  audio_voice_en       text,                    -- TTS voice used, e.g. 'en-US-AriaNeural'
  audio_voice_bg       text,                    -- e.g. 'bg-BG-KalinaNeural'
  needs_review     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Natural key used by the import script's upsert (on_conflict)
  constraint vocabulary_level_english_pos_key unique (level, english, part_of_speech)
);

create index vocabulary_level_idx on public.vocabulary (level);
create index vocabulary_english_lower_idx on public.vocabulary (lower(english));
create index vocabulary_bulgarian_lower_idx on public.vocabulary (lower(bulgarian));

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger vocabulary_set_updated_at
  before update on public.vocabulary
  for each row execute function public.set_updated_at();

-- Row Level Security: anyone (anon/authenticated) can read; only the service role
-- (which bypasses RLS) can write. No insert/update/delete policies are defined on purpose.
alter table public.vocabulary enable row level security;

create policy "Vocabulary is publicly readable"
  on public.vocabulary for select
  to anon, authenticated
  using (true);

-- Public-read storage bucket for pre-generated pronunciation files.
-- Writes happen only via the service role key.
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do nothing;
