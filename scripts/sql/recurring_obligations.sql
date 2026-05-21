-- bruce-wealth-os: 반복 의무지출 테이블
-- 월세/구독료/보험료 등 정기적으로 발생하는 고정비 + 시한성 계약 추적
-- 실거래(transactions)와 obligation_id로 연결 가능

BEGIN;

DO $$ BEGIN
  CREATE TYPE recurrence_frequency AS ENUM ('weekly','monthly','quarterly','yearly','one_time');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS recurring_obligations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL,
  amount        numeric(18,2) NOT NULL,
  vat_amount    numeric(18,2) NOT NULL DEFAULT 0,
  total_amount  numeric(18,2) GENERATED ALWAYS AS (amount + vat_amount) STORED,
  currency      text NOT NULL DEFAULT 'KRW',
  channel_id    uuid REFERENCES channels(id),
  payee         text,
  frequency     recurrence_frequency NOT NULL DEFAULT 'monthly',
  due_day       int CHECK (due_day BETWEEN 1 AND 31),
  starts_on     date NOT NULL,
  ends_on       date,
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_recurring_obligations_active   ON recurring_obligations(active);
CREATE INDEX IF NOT EXISTS idx_recurring_obligations_category ON recurring_obligations(category);
CREATE INDEX IF NOT EXISTS idx_recurring_obligations_ends_on  ON recurring_obligations(ends_on);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS obligation_id uuid REFERENCES recurring_obligations(id);

CREATE INDEX IF NOT EXISTS idx_transactions_obligation ON transactions(obligation_id);

-- 첫 row: 고덕비즈밸리 사무실+오피스텔 임대 (이사 후 통합)
INSERT INTO recurring_obligations (
  name, category, amount, vat_amount,
  channel_id, payee,
  frequency, due_day, starts_on, ends_on,
  notes, metadata
) VALUES (
  '고덕비즈밸리 아이파크더리버 1711호 임대 (사무실+오피스텔 통합)',
  'office_rent',
  2700000, 270000,
  '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd',  -- 신한 270351 사업용
  '박현주',
  'monthly', 13,
  '2026-03-13', '2027-02-13',
  '이사일 2026-03-13. 월세+관리비 통합. 부가세별도 270만원. 임대 종료 2027-02-13.',
  '{
    "address": "강동 고덕비즈밸리 아이파크더리버 1711호",
    "landlord_account": {"bank":"우리은행","number":"1002-958-297206","holder":"박현주"},
    "transaction_descriptions": ["주거통신","박현주"],
    "broker": {"name":"강성민","note":"복비 3/13 지급"}
  }'::jsonb
)
ON CONFLICT DO NOTHING;

COMMIT;

SELECT id, name, total_amount, due_day, starts_on, ends_on, payee
  FROM recurring_obligations;
