create extension if not exists "pgcrypto";

do $$
begin
  create type public.content_platform as enum ('instagram', 'tiktok', 'shorts');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.library_category as enum (
    'gancho',
    'formato',
    'angulo_camera',
    'musica',
    'efeito_sonoro',
    'cta',
    'estrutura_roteiro',
    'text_header'
  );
exception
  when duplicate_object then null;
end $$;

alter type public.library_category add value if not exists 'text_header';

do $$
begin
  create type public.library_context as enum (
    'humor',
    'educacional',
    'storytelling',
    'lifestyle',
    'upbeat'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.instagram_content_type as enum (
    'post',
    'reel',
    'story',
    'carousel',
    'video',
    'unknown'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.idea_status as enum ('disponivel', 'em_producao', 'reaproveitavel');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.piece_component_slot as enum (
    'hook',
    'format',
    'script_structure',
    'camera_angle',
    'music',
    'sound_effect',
    'cta',
    'text_header'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.ideas (
  id text primary key,
  title text not null,
  source text,
  description text,
  angle text,
  tags text[] not null default '{}',
  priority text,
  status public.idea_status not null default 'disponivel',
  created_at date not null default current_date
);

alter table public.ideas add column if not exists description text;
alter table public.ideas add column if not exists status public.idea_status not null default 'disponivel';

create table if not exists public.pieces (
  id text primary key,
  title text not null,
  idea_id text references public.ideas(id) on delete set null,
  platforms public.content_platform[] not null default '{}',
  current_phase text not null default 'brief',
  brief jsonb not null default '{}'::jsonb,
  capture jsonb not null default '{}'::jsonb,
  edit_phase jsonb not null default '{}'::jsonb,
  distribution jsonb not null default '{}'::jsonb,
  owner text,
  due date,
  updated_at timestamptz not null default now()
);

alter table public.pieces add column if not exists platforms public.content_platform[] not null default '{}';
alter table public.pieces add column if not exists current_phase text not null default 'brief';
alter table public.pieces add column if not exists brief jsonb not null default '{}'::jsonb;
alter table public.pieces add column if not exists capture jsonb not null default '{}'::jsonb;
alter table public.pieces add column if not exists edit_phase jsonb not null default '{}'::jsonb;
alter table public.pieces add column if not exists distribution jsonb not null default '{}'::jsonb;
alter table public.pieces add column if not exists updated_at timestamptz not null default now();

create table if not exists public.scripts (
  id text primary key,
  piece_id text not null unique references public.pieces(id) on delete cascade,
  template text not null,
  fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.texts (
  id text primary key,
  piece_id text references public.pieces(id) on delete set null,
  platform public.content_platform not null,
  title text not null,
  body text,
  seo_terms text[] not null default '{}',
  hashtags text[] not null default '{}',
  yt_title text,
  yt_description text,
  yt_tags text,
  updated_at timestamptz not null default now()
);

alter table public.texts add column if not exists yt_title text;
alter table public.texts add column if not exists yt_description text;
alter table public.texts add column if not exists yt_tags text;
alter table public.texts add column if not exists instagram_caption text;
alter table public.texts add column if not exists tiktok_caption text;
alter table public.texts add column if not exists updated_at timestamptz not null default now();

create table if not exists public.files (
  id text primary key,
  piece_id text references public.pieces(id) on delete cascade,
  name text not null,
  kind text,
  version text,
  location text,
  updated_at date not null default current_date
);

create table if not exists public.publications (
  id text primary key,
  piece_id text references public.pieces(id) on delete cascade,
  platform public.content_platform not null,
  published_at timestamptz,
  url text,
  metrics jsonb not null default '{"views":0,"likes":0,"saves":0,"shares":0,"comments":0}'::jsonb
);

create table if not exists public.library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category public.library_category not null,
  context public.library_context[] not null default '{}',
  platforms public.content_platform[] not null default '{}',
  notes text,
  example text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (category, name)
);

alter table public.library add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.piece_components (
  id text primary key,
  piece_id text not null references public.pieces(id) on delete cascade,
  library_item_id uuid references public.library(id) on delete set null,
  slot public.piece_component_slot not null,
  required boolean not null default false,
  used boolean not null default false,
  notes text,
  order_index integer not null default 0
);

create table if not exists public.ai_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  provider text,
  planned_hooks text[] not null default '{}'
);

create table if not exists public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text not null unique,
  username text,
  account_name text,
  profile_picture_url text,
  access_token text,
  auth_provider text not null default 'instagram' check (auth_provider in ('instagram', 'facebook')),
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

alter table public.instagram_accounts add column if not exists auth_provider text not null default 'instagram';
alter table public.instagram_accounts drop constraint if exists instagram_accounts_auth_provider_check;
alter table public.instagram_accounts
add constraint instagram_accounts_auth_provider_check
check (auth_provider in ('instagram', 'facebook'));

create table if not exists public.instagram_media (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  ig_media_id text not null unique,
  piece_id text references public.pieces(id) on delete set null,
  caption text,
  media_type public.instagram_content_type not null default 'unknown',
  permalink text,
  thumbnail_url text,
  published_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.instagram_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  media_id uuid references public.instagram_media(id) on delete cascade,
  source_type text not null check (source_type in ('account', 'media')),
  content_type public.instagram_content_type not null default 'unknown',
  metric_date date not null default current_date,
  captured_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.instagram_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  status text not null check (status in ('pending', 'running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  media_synced integer not null default 0,
  snapshots_created integer not null default 0,
  error_message text
);

insert into public.ai_settings (id, enabled, provider, planned_hooks)
values (
  1,
  true,
  'local',
  array[
    'resumir o desempenho do mês até hoje',
    'apontar o melhor conteúdo do período',
    'sinalizar quedas e picos relevantes',
    'gerar legendas com SEO e hashtags do histórico'
  ]
)
on conflict (id) do update
set
  enabled = excluded.enabled,
  provider = excluded.provider,
  planned_hooks = excluded.planned_hooks;

create index if not exists idx_ideas_status on public.ideas(status);
create index if not exists idx_pieces_idea_id on public.pieces(idea_id);
create index if not exists idx_pieces_updated_at on public.pieces(updated_at desc);
create index if not exists idx_scripts_piece_id on public.scripts(piece_id);
create index if not exists idx_piece_components_piece_id on public.piece_components(piece_id);
create index if not exists idx_piece_components_slot on public.piece_components(slot);
create index if not exists idx_library_category on public.library(category);
create index if not exists idx_texts_piece_id on public.texts(piece_id);
create index if not exists idx_files_piece_id on public.files(piece_id);
create index if not exists idx_publications_platform on public.publications(platform);
create index if not exists idx_instagram_media_account_id on public.instagram_media(account_id);
create index if not exists idx_instagram_media_type on public.instagram_media(media_type);
create index if not exists idx_instagram_media_piece_id on public.instagram_media(piece_id);
create index if not exists idx_instagram_snapshots_account_date on public.instagram_insight_snapshots(account_id, metric_date);
create index if not exists idx_instagram_snapshots_media_id on public.instagram_insight_snapshots(media_id);
create index if not exists idx_instagram_sync_runs_account_id on public.instagram_sync_runs(account_id);

alter table public.ideas disable row level security;
alter table public.pieces disable row level security;
alter table public.scripts disable row level security;
alter table public.piece_components disable row level security;
alter table public.texts disable row level security;
alter table public.files disable row level security;
alter table public.publications disable row level security;
alter table public.library disable row level security;
alter table public.ai_settings disable row level security;
alter table public.instagram_accounts disable row level security;
alter table public.instagram_media disable row level security;
alter table public.instagram_insight_snapshots disable row level security;
alter table public.instagram_sync_runs disable row level security;
