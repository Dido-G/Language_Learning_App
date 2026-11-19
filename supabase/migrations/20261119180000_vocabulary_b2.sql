-- Allow CEFR level B2 in public.vocabulary (idempotent).
alter table public.vocabulary drop constraint if exists vocabulary_level_check;
alter table public.vocabulary
  add constraint vocabulary_level_check check (level in ('A1', 'A2', 'B1', 'B2'));
