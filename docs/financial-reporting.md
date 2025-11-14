# Financial Reporting Views

이 문서는 Postgres에 적재된 `transactions` 데이터를 기반으로 **월별/분기별/반기별 대차대조표**와 **월별 현금흐름표**를 생성하는 방법을 설명합니다. 모든 뷰는 `scripts/sql/reporting_financial_statements.sql` 스크립트를 실행하면 `reporting` 스키마에 생성됩니다.

## 1. 생성되는 뷰 요약

| View | 설명 |
| --- | --- |
| `reporting.channel_roles` | 채널 메타데이터를 읽어 `reporting_role`(asset/liability)과 `cash_flow_activity`(operating/investing/financing)를 파생. 기본값은 asset/operating. |
| `reporting.asset_cash_transactions` | `channel_roles`를 활용해 자산(현금) 채널 거래만 필터링. |
| `reporting.internal_asset_transfers` | 자산 채널 간 동일 금액·근접 시각(+/-15분)의 입·출금을 짝지어 내부 이체 후보를 추출. |
| `reporting.external_asset_transactions` | 내부 이체 후보를 제외한 순수 외부 현금 흐름만 남긴 자산 거래. `cash_flow_monthly`의 입력이 됨. |
| `reporting.calendar` | 거래가 있는 날짜 구간을 일 단위로 생성. |
| `reporting.channel_daily_balances` | 채널별 일별 누적 잔액(거래 금액 누계) 스냅샷. |
| `reporting.balance_sheet_monthly_channel` | 채널별 월말 잔액. |
| `reporting.balance_sheet_quarterly_channel` | 채널별 분기말 잔액. |
| `reporting.balance_sheet_half_year_channel` | 채널별 반기말 잔액. |
| `reporting.balance_sheet_*_summary` | 위 세 채널 뷰를 집계해 자산/부채/자기자본(=자산-부채) 요약. |
| `reporting.cash_flow_monthly` | `external_asset_transactions`를 월별로 집계해 영업/투자/재무 및 순현금 흐름을 계산. 내부 이체는 자동으로 제외됩니다. |
| `reporting.income_source_monthly_summary` | 입금 거래를 적요 패턴에 따라 수입원별로 분류해 월별 합계를 계산합니다. |
| `reporting.card_installment_plans` | 카드 채널에서 적발된 할부 거래를 카드사별/거래별로 구조화한 뷰입니다. 총액, 할부개월, 남은 개월/잔여 원금이 포함됩니다. |
| `reporting.card_installment_schedule` | 각 할부 거래가 월별로 얼마씩 상환되는지 일정표 형태로 전개한 뷰입니다. 향후 월별 카드 현금 유출 계획을 세울 때 활용할 수 있습니다. |

> **주의**: 카드 채널의 `closing_balance`는 음수(부채)로 누적됩니다. 숫자를 양수로 보고 싶다면 쿼리에서 `abs()`를 적용하세요.

> **부호 정규화 가이드**: 카카오페이처럼 거래 유형이 `[+] 충전`, `[-] 결제` 형태로 제공되는 경우 JSON → DB 적재 시 반드시 부호를 일치시켜야 합니다. `scripts/db/generate-transaction-sql.js`는 이 프리픽스를 감지해 금액 부호를 자동 보정합니다. 과거 데이터에 잘못된 부호가 남았다면 `cat scripts/sql/fix_amount_signs.sql | docker exec -i finanz-postgres psql -U postgres -d postgres` 명령으로 일괄 수정한 뒤 보고용 뷰를 재생성하세요.

## 2. 스크립트 실행

1. Docker로 띄운 Postgres 컨테이너를 대상으로 아래 명령을 실행합니다.

   ```bash
   docker exec -i finanz-postgres \
     psql -U postgres -d postgres \
     -f scripts/sql/reporting_financial_statements.sql
   ```

2. 스크립트는 여러 번 실행해도 안전합니다(`create or replace view`).

3. 적용 후에는 `reporting.*` 뷰를 바로 쿼리할 수 있습니다.

## 3. 채널 분류 커스터마이징

- 기본 규칙은 다음과 같습니다.
  - 이름에 `"카드"`가 포함되면 `reporting_role = 'liability'` 로 간주.
  - 나머지는 모두 `asset`.
  - `cash_flow_activity` 기본값은 `operating`.
- 채널 메타데이터에 아래 속성을 넣으면 뷰가 자동으로 반영합니다.

  ```sql
  update channels
     set metadata = metadata || jsonb_build_object(
       'reporting_role', 'asset',
       'cash_flow_activity', 'investing'
     )
   where id = '...';
  ```

  가능한 값: `reporting_role` = `asset` / `liability` / `equity`(추후 확장), `cash_flow_activity` = `operating` / `investing` / `financing`.

## 4. 예시 쿼리

### 4.1 월별 대차대조표 요약
```sql
select period_start, period_end, assets, liabilities, equity
from reporting.balance_sheet_monthly_summary
order by period_start;
```

### 4.2 분기별 채널 상세
```sql
select period_start, period_end, c.name, b.closing_balance
from reporting.balance_sheet_quarterly_channel b
join reporting.channel_roles c on c.id = b.channel_id
order by period_start, c.name;
```

### 4.3 월별 현금흐름표
```sql
select period_start,
       operating_cash_flow,
       investing_cash_flow,
       financing_cash_flow,
       net_cash_flow
from reporting.cash_flow_monthly
order by period_start;
```

### 4.4 최근 월 자료만 조회
```sql
select *
from reporting.cash_flow_monthly
order by period_start desc
limit 3;
```

## 5. 향후 확장 아이디어
- `reporting.channel_roles`를 materialized view로 승격하고, 태그/카테고리 테이블을 조인해 정확도를 높입니다.
- `cash_flow_activity`를 거래 카테고리(`transactions.category`)나 `match_id`를 기준으로 자동 분류.
- 생성된 뷰를 이용해 `data/financial.md` 요약을 자동 생성하는 CLI를 추가.
- React UI에서 `balance_sheet_*_summary` 결과를 차트로 시각화하고, MCP tool에서 월별/분기별 리포트 호출 지원.
- 부호 정규화 테스트(`npm run test:reports`)를 CI에 추가해 내부 이체 제거 로직과 함께 항상 통과하는지 확인.

## 6. API & Web UI 연동
- `POSTGRES_PSQL` 환경 변수를 통해 CLI 경로를 제어할 수 있습니다. 기본값은 `docker exec -i finanz-postgres psql -U postgres -d postgres`이며, 로컬 `psql`을 쓰고 싶다면 `POSTGRES_PSQL="psql -U postgres -d postgres"` 형태로 지정하세요. 비활성화하려면 `POSTGRES_PSQL=disable`로 설정합니다.
- API 엔드포인트: `GET /reports/cashflow/monthly` — `reporting.cash_flow_monthly` 뷰를 JSON으로 반환합니다. 내부 이체(자산 채널 간 동일 금액·근접 시각)로 판정된 전표는 자동 제외되므로 실질적인 외부 현금 유입/유출만 집계됩니다.
- API 엔드포인트: `GET /reports/balance-sheet/monthly` — `reporting.balance_sheet_monthly_summary` 및 `balance_sheet_monthly_channel` 뷰를 함께 조회합니다.
- API 엔드포인트: `GET /reports/income-sources/monthly` — `reporting.income_source_monthly_summary` 뷰를 조회해 월별 수입원별 합계와 건수를 제공합니다.
- API 엔드포인트: `GET /reports/card-installments` — `reporting.card_installment_plans` 뷰를 조회해 카드사별 할부 거래 총액, 월 상환액, 잔여 월 수를 정리합니다. 필요 시 `card_installment_schedule` 뷰로 월별 일정까지 확인할 수 있습니다.
- 웹 UI의 **Cashflow** / **Balance Sheet** 탭이 위 엔드포인트에 연결되어 월별 현금흐름표와 대차대조표를 표시합니다.
