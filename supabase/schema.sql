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

-- Head-to-head rounds and viewer votes
create table if not exists rounds (
  id bigint generated always as identity primary key,
  prompt text not null,
  prompt_from_chat boolean not null default false,
  start_message_id bigint not null default 0,
  status text not null default 'painting' check (status in ('painting', 'voting', 'done')),
  voting_ends_at timestamptz,
  winner text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists votes (
  round_id bigint not null references rounds(id) on delete cascade,
  voter text not null,
  choice text not null check (choice in ('A', 'B')),
  created_at timestamptz not null default now(),
  primary key (round_id, voter)
);

alter table rounds enable row level security;
alter table votes enable row level security;
