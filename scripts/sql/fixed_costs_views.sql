-- bruce-wealth-os: 고정비/구독 모니터링 view
-- recurring_obligations + subscriptions를 통합해서 다음 결제일·월합계·만료알림 제공

BEGIN;

CREATE SCHEMA IF NOT EXISTS reporting;

-- 1. 다음 결제 예정일 (recurring_obligations 기반)
CREATE OR REPLACE VIEW reporting.upcoming_obligations AS
SELECT
  o.id,
  o.name,
  o.category,
  o.total_amount,
  o.payee,
  o.due_day,
  o.frequency,
  CASE
    WHEN o.frequency = 'monthly' AND o.due_day IS NOT NULL THEN
      (date_trunc('month', CURRENT_DATE) + ((o.due_day - 1) || ' days')::interval)::date
      + CASE WHEN EXTRACT(DAY FROM CURRENT_DATE) > o.due_day THEN INTERVAL '1 month' ELSE INTERVAL '0' END
    ELSE NULL
  END AS next_due_on,
  o.ends_on,
  CASE WHEN o.ends_on IS NOT NULL THEN (o.ends_on - CURRENT_DATE) END AS days_until_end,
  c.name AS channel
FROM recurring_obligations o
LEFT JOIN channels c ON c.id = o.channel_id
WHERE o.active = true
ORDER BY next_due_on NULLS LAST;

-- 2. 월 고정비 요약 (의무 + 활성 구독 통합)
CREATE OR REPLACE VIEW reporting.monthly_fixed_costs AS
SELECT 'obligation' AS source, name, category, total_amount AS monthly_amount, 'KRW' AS currency
  FROM recurring_obligations WHERE active = true AND frequency = 'monthly'
UNION ALL
SELECT 'subscription', service_name, category,
       CASE WHEN billing_cycle = 'yearly' THEN amount_estimate / 12.0 ELSE amount_estimate END,
       currency
  FROM subscriptions WHERE status = 'active'
ORDER BY monthly_amount DESC;

-- 3. 임대/약정 만료 알림 (90일 이내)
CREATE OR REPLACE VIEW reporting.expiring_soon AS
SELECT id, name, ends_on, (ends_on - CURRENT_DATE) AS days_left, total_amount, payee
  FROM recurring_obligations
 WHERE active = true AND ends_on IS NOT NULL AND ends_on >= CURRENT_DATE
   AND ends_on <= CURRENT_DATE + INTERVAL '365 days'
 ORDER BY ends_on;

-- 4. 무결제 알림 (active 구독인데 marker 기준 일수 이상 결제 없음)
CREATE OR REPLACE VIEW reporting.stale_subscriptions AS
SELECT
  service_name, status, amount_estimate, billing_cycle,
  last_charged_at::date AS last_charged_on,
  (CURRENT_DATE - last_charged_at::date) AS days_since_last_charge
FROM subscriptions
WHERE status = 'active'
  AND (
    (billing_cycle = 'monthly'  AND last_charged_at < CURRENT_DATE - INTERVAL '45 days')
 OR (billing_cycle = 'yearly'   AND last_charged_at < CURRENT_DATE - INTERVAL '400 days')
 OR (billing_cycle = 'quarterly' AND last_charged_at < CURRENT_DATE - INTERVAL '120 days')
  )
ORDER BY days_since_last_charge DESC;

COMMIT;

-- 결과 확인
\echo '=== 다음 결제 예정 ==='
SELECT name, total_amount, next_due_on, days_until_end FROM reporting.upcoming_obligations;

\echo ''
\echo '=== 월 고정비 합계 ==='
SELECT source, COUNT(*) AS items, SUM(monthly_amount)::int AS total
  FROM reporting.monthly_fixed_costs GROUP BY source UNION ALL
SELECT 'TOTAL', COUNT(*), SUM(monthly_amount)::int FROM reporting.monthly_fixed_costs;

\echo ''
\echo '=== 임대/약정 만료 ==='
SELECT * FROM reporting.expiring_soon;

\echo ''
\echo '=== 무결제 알림 ==='
SELECT * FROM reporting.stale_subscriptions;
