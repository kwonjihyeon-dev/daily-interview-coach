create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade on update cascade,
  type text not null check (type in ('resume', 'notion')),
  raw_text text not null,
  source_url text,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade on update cascade,
  source_id uuid references sources(id) on delete set null,
  category text not null,
  text text not null,
  origin text not null check (origin in ('seed', 'ai')),
  created_at timestamptz not null default now()
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade on update cascade,
  body text not null,
  answered_at timestamptz not null default now()
);

create table answer_feedback (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references answers(id) on delete cascade,
  feedback_text text not null,
  requested_at timestamptz not null default now()
);

create table streaks (
  user_id uuid primary key references users(id) on delete cascade on update cascade,
  current integer not null default 0,
  longest integer not null default 0,
  last_date date
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade on update cascade,
  endpoint text not null,
  keys_json jsonb not null,
  created_at timestamptz not null default now()
);

create index on sources (user_id);
create index on questions (user_id);
create index on questions (source_id);
create index on answers (question_id);
create index on answers (user_id);
create index on answer_feedback (answer_id);
create index on push_subscriptions (user_id);
