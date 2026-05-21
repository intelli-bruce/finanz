#!/usr/bin/env python3
"""bruce-wealth-os 대시보드용 데이터 export — DB → dashboard/data.json"""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg2
import psycopg2.extras

DSN = "dbname=postgres"
OUT = Path(__file__).parent / "data.json"


def to_json(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (date,)):
        return o.isoformat()
    raise TypeError(f"Unhandled: {type(o)}")


def query_all(cur, sql):
    cur.execute(sql)
    return [dict(r) for r in cur.fetchall()]


def main():
    conn = psycopg2.connect(DSN)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    data = {}

    # 1. 채널별 잔액
    data["balances"] = query_all(cur, """
        SELECT c.name AS channel, t.balance, t.occurred_at::date AS as_of
        FROM transactions t
        JOIN channels c ON t.channel_id = c.id
        JOIN (
          SELECT channel_id, MAX(occurred_at) AS m
          FROM transactions WHERE balance IS NOT NULL
          GROUP BY channel_id
        ) latest ON latest.channel_id = t.channel_id AND latest.m = t.occurred_at
        ORDER BY t.balance DESC NULLS LAST;
    """)

    # 2. 월별 수입/지출 (외부만)
    data["monthly_cashflow"] = query_all(cur, """
        SELECT
          to_char(occurred_at, 'YYYY-MM') AS month,
          SUM(amount) FILTER (WHERE amount > 0) AS income,
          SUM(amount) FILTER (WHERE amount < 0) AS expense,
          SUM(amount) AS net
        FROM transactions
        WHERE match_id IS NULL
          AND (category IS NULL OR category NOT IN ('self_transfer','card_payment'))
        GROUP BY month
        HAVING to_char(occurred_at,'YYYY-MM') >= '2025-01'
        ORDER BY month;
    """)

    # 3. 4월 카테고리별 지출 Top 10
    data["expense_by_category"] = query_all(cur, """
        SELECT category, SUM(amount) AS total, COUNT(*) AS cnt
        FROM transactions
        WHERE occurred_at >= '2026-04-01' AND occurred_at < '2026-05-01'
          AND amount < 0
          AND match_id IS NULL
          AND (category IS NULL OR category NOT IN ('self_transfer','card_payment'))
        GROUP BY category
        ORDER BY total ASC
        LIMIT 10;
    """)

    # 4. 향후 receivables 캘린더 (1년)
    data["upcoming_receivables"] = query_all(cur, """
        SELECT contract_name, stage_name, expected_date, total_amount, confidence
        FROM receivables
        WHERE status = 'pending'
        ORDER BY expected_date;
    """)

    # 5. 다음 결제 예정 (obligations)
    data["upcoming_obligations"] = query_all(cur, """
        SELECT name, total_amount, due_day,
               CASE WHEN due_day IS NOT NULL THEN
                 (date_trunc('month', CURRENT_DATE) + ((due_day - 1) || ' days')::interval)::date
                 + CASE WHEN EXTRACT(DAY FROM CURRENT_DATE) > due_day THEN INTERVAL '1 month' ELSE INTERVAL '0' END
               END::date AS next_due,
               ends_on
        FROM recurring_obligations
        WHERE active = true
        ORDER BY next_due NULLS LAST;
    """)

    # 6. 활성 구독 합계
    data["active_subscriptions"] = query_all(cur, """
        SELECT service_name, amount_estimate, currency, billing_cycle, last_charged_at::date AS last
        FROM subscriptions
        WHERE status = 'active'
        ORDER BY amount_estimate DESC;
    """)

    # 7. 무결제 알림
    data["stale_subscriptions"] = query_all(cur, """
        SELECT service_name, amount_estimate, last_charged_at::date AS last,
               (CURRENT_DATE - last_charged_at::date) AS days_stale
        FROM subscriptions
        WHERE status = 'active'
          AND ((billing_cycle='monthly'  AND last_charged_at < CURRENT_DATE - INTERVAL '45 days')
            OR (billing_cycle='yearly'   AND last_charged_at < CURRENT_DATE - INTERVAL '400 days'))
        ORDER BY days_stale DESC;
    """)

    # 8. 월별 receivables 합계 (confidence 별)
    data["monthly_receivables"] = query_all(cur, """
        SELECT to_char(expected_date, 'YYYY-MM') AS month,
               confidence::text AS confidence,
               SUM(total_amount) AS total
        FROM receivables WHERE status = 'pending'
        GROUP BY month, confidence ORDER BY month;
    """)

    # 9. 임대 만료 알림
    data["expiring_obligations"] = query_all(cur, """
        SELECT name, ends_on, (ends_on - CURRENT_DATE) AS days_left, total_amount
        FROM recurring_obligations
        WHERE active=true AND ends_on IS NOT NULL
          AND ends_on >= CURRENT_DATE AND ends_on <= CURRENT_DATE + INTERVAL '400 days'
        ORDER BY ends_on;
    """)

    # 10. 메타
    cur.execute("SELECT MAX(occurred_at)::date AS last_tx, COUNT(*) AS total_tx FROM transactions;")
    data["meta"] = dict(cur.fetchone())
    data["meta"]["generated_at"] = date.today().isoformat()

    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=to_json))
    print(f"✅ {OUT} ({sum(len(v) if isinstance(v,list) else 1 for v in data.values())} rows total)")


if __name__ == "__main__":
    main()
