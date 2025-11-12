-- Core tables for Finanz (local Postgres)

create extension if not exists pgcrypto;

-- Create custom types (with DO block for idempotency)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'channel_type') then
    create type channel_type as enum ('bank', 'card', 'wallet', 'investment', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_origin') then
    create type transaction_origin as enum ('actual', 'forecast', 'scenario');
  end if;
end $$;

create table if not exists transaction_files (
  id              uuid primary key default gen_random_uuid(),
  schema_version  text not null,
  source_file     text not null,
  timezone        text not null,
  currency        text default 'KRW',
  account_bank    text not null,
  account_holder  text not null,
  account_number  text,
  account_email   text,
  channel_type    channel_type default 'bank',
  period_from     timestamptz,
  period_to       timestamptz,
  summary         jsonb,
  created_at      timestamptz not null default now()
);

-- Add unique constraint on source_file
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transaction_files_source_unique'
  ) then
    alter table transaction_files
      add constraint transaction_files_source_unique unique (source_file);
  end if;
end $$;

create table if not exists channels (
  id              uuid primary key default gen_random_uuid(),
  external_id     text unique,
  name            text not null,
  type            channel_type not null,
  bank            text,
  masked_number   text,
  owner           text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists transactions (
  id                  uuid primary key default gen_random_uuid(),
  file_id             uuid references transaction_files(id) on delete cascade,
  channel_id          uuid references channels(id),
  counter_channel_id  uuid references channels(id),
  record_id           text not null,
  occurred_at         timestamptz,
  confirmed_at        timestamptz,
  description         text not null,
  transaction_type    text not null,
  amount              numeric(18,2),
  balance             numeric(18,2),
  memo                text,
  origin              transaction_origin not null default 'actual',
  match_id            text,
  category            text,
  tags                text[],
  metadata            jsonb,
  raw                 jsonb not null,
  created_at          timestamptz not null default now()
);

-- Add unique constraint on (file_id, record_id)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_file_record_unique'
  ) then
    alter table transactions
      add constraint transactions_file_record_unique unique (file_id, record_id);
  end if;
end $$;

create index if not exists idx_transactions_occurred_at on transactions(occurred_at);
create index if not exists idx_transactions_channel on transactions(channel_id);
create index if not exists idx_transactions_type on transactions(transaction_type);
