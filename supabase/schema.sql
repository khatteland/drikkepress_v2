
create table if not exists public.profiles (
  id uuid primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  phone text,
  created_at timestamptz default now()
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  slug text not null,
  description text,
  cover_url text,
  gallery jsonb default '[]'::jsonb,
  start_time timestamptz not null,
  end_time timestamptz,
  location text,
  latitude double precision,
  longitude double precision,
  participants_public boolean default true,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, slug)
);
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status text check (status in ('going','interested','cant')) not null,
  created_at timestamptz default now(),
  unique(event_id, user_id)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.participants enable row level security;
alter table public.comments enable row level security;
