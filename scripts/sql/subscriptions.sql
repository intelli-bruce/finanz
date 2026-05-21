-- bruce-wealth-os: SaaS 구독 전용 테이블
-- recurring_obligations와 별도. SaaS는 해지/일시중단/요금 변동이 잦아
-- status enum과 last_charged_at 추적이 필요해 별도 모델링.

BEGIN;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM
    ('active','paused','cancelled','trial','trial_expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name        text NOT NULL,
  vendor              text,
  description_pattern text NOT NULL,
  category            text,
  channel_id          uuid REFERENCES channels(id),
  amount_estimate     numeric(18,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'KRW',
  billing_cycle       text NOT NULL DEFAULT 'monthly',
  due_day             int CHECK (due_day BETWEEN 1 AND 31),
  starts_on           date,
  ends_on             date,
  status              subscription_status NOT NULL DEFAULT 'active',
  cancel_reason       text,
  last_charged_at     timestamptz,
  notes               text,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_pattern  ON subscriptions(description_pattern);
CREATE INDEX IF NOT EXISTS idx_subscriptions_category ON subscriptions(category);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES subscriptions(id);

CREATE INDEX IF NOT EXISTS idx_transactions_subscription ON transactions(subscription_id);

COMMIT;
