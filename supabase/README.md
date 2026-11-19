# Supabase

Run the files in `migrations/` in order (Dashboard → SQL Editor, or `supabase db push`).
`vocabulary(id, level, english, bg)` has a unique key on `(level, english)`; the app reads it
with the anon key (RLS: public read) and `tools/vocab` writes with the service-role key.
