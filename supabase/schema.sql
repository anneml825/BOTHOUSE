-- Run once in Supabase → SQL Editor → New query → Run.

create table if not exists messages (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('bots', 'chat')),
  author text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_channel_id on messages (channel, id desc);

create table if not exists turn_lock (
  id int primary key,
  locked_until timestamptz not null default 'epoch'
);

insert into turn_lock (id) values (1) on conflict do nothing;

-- Only the server (service role key) reads and writes these tables.
alter table messages enable row level security;
alter table turn_lock enable row level security;

-- Saved drawings for the gallery
create table if not exists drawings (
  id bigint generated always as identity primary key,
  title text not null default '',
  shapes jsonb not null,
  created_at timestamptz not null default now()
);

alter table drawings enable row level security;
