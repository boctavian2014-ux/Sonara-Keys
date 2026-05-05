-- Sonara Keys — melodii în cloud (Supabase).
-- Rulează în SQL Editor din dashboard sau cu Supabase CLI.
-- Proiect: https://supabase.com/dashboard/project/hctlyggquhrxmdeiolmc

create table if not exists public.melodies (
  kinde_sub text not null,
  id text not null,
  schema_version int not null default 1,
  title text not null,
  notes jsonb not null,
  created_at_iso timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (kinde_sub, id)
);

create index if not exists melodies_kinde_sub_idx on public.melodies (kinde_sub);

alter table public.melodies enable row level security;

-- ATENȚIE (dev / prototip): politica de mai jos permite oricui cu cheia anon să citească/scrie TOATE rândurile.
-- Înainte de producție: înlocuiește cu politici bazate pe JWT (ex. Third-party auth / Edge Function + service role)
-- sau restricționează accesul la rolul service_role doar din backend.
create policy "melodies_dev_open_anon"
on public.melodies
for all
to anon, authenticated
using (true)
with check (true);
