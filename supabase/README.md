# Supabase

Apply migrations in order via the SQL editor (Dashboard → SQL Editor) or the CLI:

    supabase link --project-ref pfjummblqqypqtcfsfhk
    supabase db push

The old `a1_words` test table (5 rows) is superseded by `vocabulary` and can be dropped
once the new table is populated: `drop table public.a1_words;`
