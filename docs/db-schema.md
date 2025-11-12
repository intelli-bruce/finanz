# Finanz Database Schema (Draft)

## 1. Overview
PostgreSQL is the canonical data store. JSON files remain for snapshots, but ingestion pipelines primarily interact with **세 가지 테이블만** 사용합니다:

1. `transaction_files` – 가져온 파일/소스 메타데이터.
2. `channels` – 계좌/카드/페이 등 금융 채널.
3. `transactions` – 표준화된 거래 레코드.

나머지(`transaction_tags`, `income_sources`, `scenarios`, `advices` 등)는 필요 시 확장 모듈로 추가합니다. **MVP 단계에서는 아래 세 테이블만 생성**하면 충분합니다.

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

alter table transaction_files
  add constraint transaction_files_source_unique
  unique (source_file);

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

alter table transactions
  add constraint transactions_file_record_unique
  unique (file_id, record_id);

-- 확장 테이블(transaction_tags, income_sources 등)은 필요 시 별도 스크립트에서 정의합니다.
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
- **Sign normalization**: JSON ingest와 SQL dump 단계에서 거래 유형의 `[+]` / `[-]` 프리픽스를 감지해 `transactions.amount` 부호를 강제합니다. 레거시 데이터는 `scripts/sql/fix_amount_signs.sql`을 실행해 한 번 더 보정한 뒤 `npm run test:reports`로 회계 무결성을 검증하세요.
