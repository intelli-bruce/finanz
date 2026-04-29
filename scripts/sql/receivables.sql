-- finanz: receivables (외상매출금/청구권)
-- 계약 기반 청구권을 추적. forecast 거래와 달리 변경 비용 낮음.
-- 실제 입금 발생 시 transactions.receivable_id로 연결.

BEGIN;

DO $$ BEGIN
  CREATE TYPE receivable_status AS ENUM
    ('pending','invoiced','partial','received','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE receivable_confidence AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS receivables (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_name         text NOT NULL,
  stage_name            text,
  expected_amount       numeric(18,2) NOT NULL,
  vat_amount            numeric(18,2) NOT NULL DEFAULT 0,
  total_amount          numeric(18,2) GENERATED ALWAYS AS
                          (expected_amount + vat_amount) STORED,
  expected_date         date NOT NULL,
  expected_channel_id   uuid REFERENCES channels(id),
  payer                 text,
  status                receivable_status NOT NULL DEFAULT 'pending',
  confidence            receivable_confidence NOT NULL DEFAULT 'medium',
  invoiced_at           timestamptz,
  received_at           timestamptz,
  received_amount       numeric(18,2),
  notes                 text,
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receivables_status        ON receivables(status);
CREATE INDEX IF NOT EXISTS idx_receivables_expected_date ON receivables(expected_date);
CREATE INDEX IF NOT EXISTS idx_receivables_contract      ON receivables(contract_name);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS receivable_id uuid REFERENCES receivables(id);
CREATE INDEX IF NOT EXISTS idx_transactions_receivable ON transactions(receivable_id);

COMMIT;

-- ===== 뉴스캐시 갱신 12건 =====
-- 라이즌스퀘어가 스튜디오일육일에서 받음. 사용자 요청으로 2026-04부터
-- 신한270351(인텔리이펙트 사업용)로 직접이체 변경 추진중.
-- VAT 10% 포함 기준. confidence=medium (변동 가능성 명시).
INSERT INTO receivables (contract_name, stage_name, expected_amount, vat_amount, expected_date, expected_channel_id, payer, status, confidence, notes, metadata)
SELECT '뉴스캐시 유지보수 및 관리 (갱신)', stage, amt, amt * 0.1, due, '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd', '라이즌스퀘어', 'pending', 'medium', notes, metadata
FROM (VALUES
  ('1단계 1차분 (4월분)',  23250000::numeric, '2026-05-31'::date, '4월 세금계산서 → 5월 말 입금', '{"contract_period":"2026-04-08~2026-06-07","monthly_rate":23250000,"channel_change":"2026-04부터 신한270351 직접이체 요청"}'::jsonb),
  ('1단계 2차분 (5월분)',  23250000::numeric, '2026-06-30'::date, '5월 세금계산서 → 6월 말 입금', '{"contract_period":"2026-04-08~2026-06-07","monthly_rate":23250000}'::jsonb),
  ('2단계 (6월분, 정점)',   29000000::numeric, '2026-07-31'::date, '6월 세금계산서 → 7월 말 입금. 단계 정점.', '{"contract_period":"2026-06-08~2026-07-07","monthly_rate":29000000}'::jsonb),
  ('3단계 1차분 (7월분)',   6000000::numeric, '2026-08-31'::date, '유지보수 단계 진입', '{"contract_period":"2026-07-08~2027-04-07","monthly_rate":6000000}'::jsonb),
  ('3단계 2차분 (8월분)',   6000000::numeric, '2026-09-30'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 3차분 (9월분)',   6000000::numeric, '2026-10-31'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 4차분 (10월분)',  6000000::numeric, '2026-11-30'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 5차분 (11월분)',  6000000::numeric, '2026-12-31'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 6차분 (12월분)',  6000000::numeric, '2027-01-31'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 7차분 (1월분)',   6000000::numeric, '2027-02-28'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 8차분 (2월분)',   6000000::numeric, '2027-03-31'::date, NULL, '{"monthly_rate":6000000}'::jsonb),
  ('3단계 9차분 (3월분, 마지막)', 6000000::numeric, '2027-04-30'::date, '계약 만료 직후', '{"monthly_rate":6000000,"contract_end":"2027-04-07"}'::jsonb)
) AS t(stage, amt, due, notes, metadata);

-- ===== IpOnOff MVP 2건 (착수금 23.2M는 4-13에 이미 수령 완료, 제외) =====
-- 발주: 유버, 수주: 인텔리이펙트 직접
INSERT INTO receivables (contract_name, stage_name, expected_amount, vat_amount, expected_date, expected_channel_id, payer, status, confidence, notes, metadata) VALUES
('IpOnOff MVP 소프트웨어 개발', '중도금 (30%, 50% 진척 시)',
 17400000, 1740000, '2026-06-15',
 '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd', '유버 주식회사',
 'pending', 'medium',
 '50% 진척 시점(약 7주차, 5-31~6-01) + 세금계산서 후 10영업일',
 '{"contract_period":"2026-04-13~2026-07-20","milestone":"50%","payment_trigger":"세금계산서 + 10영업일"}'::jsonb),
('IpOnOff MVP 소프트웨어 개발', '잔금 (30%, 검수 완료 시)',
 17400000, 1740000, '2026-08-31',
 '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd', '유버 주식회사',
 'pending', 'low',
 '14주차 7-20 인도 + 검수 4주(~8-17) + 세금계산서 + 10영업일. 검수 지연 가능.',
 '{"contract_period":"2026-04-13~2026-07-20","milestone":"final","payment_trigger":"검수 완료 + 세금계산서 + 10영업일"}'::jsonb);

-- 이미 수령된 착수금도 기록(연결용, status=received)
INSERT INTO receivables (contract_name, stage_name, expected_amount, vat_amount, expected_date, expected_channel_id, payer, status, confidence, received_at, received_amount, notes)
VALUES
('IpOnOff MVP 소프트웨어 개발', '착수금 (40%)',
 23200000, 2320000, '2026-04-20',
 '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd', '유버 주식회사',
 'received', 'high',
 '2026-04-13T15:20:00+09:00', 25520000,
 '4-13 신한270351 입금 7건 합산 25,520,000 = 착수금 VAT포함');

-- 4-13 거래를 착수금 receivable에 연결
UPDATE transactions t
   SET receivable_id = r.id
  FROM receivables r
 WHERE r.contract_name = 'IpOnOff MVP 소프트웨어 개발'
   AND r.stage_name LIKE '착수금%'
   AND t.channel_id = '5b416079-1c62-4c4e-8e27-d22e4ed6a3bd'
   AND t.occurred_at::date = '2026-04-13'
   AND t.description = '유버(주)';

-- 결과
SELECT contract_name, stage_name, total_amount, expected_date, status, confidence
  FROM receivables
 ORDER BY expected_date;
