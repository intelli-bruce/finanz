# Finanz Database Schema (Draft)

## 1. Overview
PostgreSQL is used as the canonical data store. JSON files remain for snapshots, but ingestion pipelines write into the following tables:

- `transaction_files`: metadata for each imported file.
- `channels`: bank/card/wallet/investment entities.
- `transactions`: normalized transaction records.
- `transaction_tags`: mapping table for free-form tags.
- `income_sources`, `transaction_income_sources`: optional mapping for recurring revenue streams.
- `scenarios`, `scenario_transactions`: forecast / simulation inputs.
- `advices`: LLM/MCP output history (future).

## 2. DDL (PostgreSQL)
```sql
create type channel_type as enum ('bank', 'card', 'wallet', 'investment', 'other');
create type transaction_origin as enum ('actual', 'forecast', 'scenario');

create table transaction_files (
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

create table channels (
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

create table transactions (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid references transaction_files(id) on delete cascade,
  channel_id      uuid references channels(id),
  counter_channel_id uuid references channels(id),
  record_id       text not null, -- original id (e.g., coupang-123)
  occurred_at     timestamptz,
  confirmed_at    timestamptz,
  description     text not null,
  transaction_type text not null,
  amount          numeric(18,2),
  balance         numeric(18,2),
  memo            text,
  origin          transaction_origin not null default 'actual',
  match_id        text,
  category        text,
  tags            text[],
  metadata        jsonb,
  raw             jsonb not null,
  created_at      timestamptz not null default now()
);

create table transaction_tags (
  transaction_id  uuid references transactions(id) on delete cascade,
  tag             text not null,
  primary key (transaction_id, tag)
);

create table income_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create table transaction_income_sources (
  transaction_id  uuid references transactions(id) on delete cascade,
  income_source_id uuid references income_sources(id) on delete cascade,
  amount_override numeric(18,2),
  primary key (transaction_id, income_source_id)
);

create table scenarios (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create table scenario_transactions (
  id              uuid primary key default gen_random_uuid(),
  scenario_id     uuid references scenarios(id) on delete cascade,
  base_transaction_id uuid references transactions(id),
  record_id       text,
  occurred_at     timestamptz,
  description     text not null,
  transaction_type text not null,
  amount          numeric(18,2),
  metadata        jsonb,
  raw             jsonb,
  created_at      timestamptz not null default now()
);

create table advices (
  id              uuid primary key default gen_random_uuid(),
  issued_at       timestamptz not null default now(),
  advisor         text default 'LLM-MCP',
  scenario_id     uuid references scenarios(id),
  content         text not null,
  metadata        jsonb
);
```

## 3. Relationships
- `transaction_files` ← `transactions`: each transaction belongs to the file it was imported from.
- `channels`: referenced twice (primary and counter). When counterparty is unknown, the field can be null.
- `transaction_tags` / `transaction_income_sources`: allow many-to-many tagging and income source tracking.
- `scenarios` & `scenario_transactions`: support forecasts and what-if simulations.

## 4. Indexing Suggestions
```sql
create index idx_transactions_occurred_at on transactions(occurred_at);
create index idx_transactions_type on transactions(transaction_type);
create index idx_transactions_match on transactions(match_id);
create index idx_transactions_channel on transactions(channel_id);
create index idx_transactions_origin on transactions(origin);
```

## 5. Migration Notes
1. Existing JSON files can be iterated and inserted into `transaction_files` + `transactions`. Use `schemaVersion` to determine mapping.
2. `channels` can be auto-generated using distinct `account.bank + account.number` combos, then manually curated.
3. After migration, ingestion scripts should write both JSON (for backups) and DB rows.

## 6. Future Enhancements
- Materialized views for monthly summaries per channel.
- `flows` table to persist matched transfer edges.
- Audit triggers for changes (esp. tags, categories, scenario edits).
