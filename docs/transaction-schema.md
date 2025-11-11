# Transaction Schema Specification

## 1. File Structure (`TransactionFile`)
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schemaVersion` | `string` | ✅ | Semantic version of this schema (e.g., `1.0.0`). |
| `generatedAt` | `string` (ISO datetime) | ✅ | Timestamp when this JSON was produced. |
| `sourceFile` | `string` | ✅ | Original file or system that produced the data. |
| `timezone` | `string` | ✅ | Timezone offset used when parsing (`+09:00`). |
| `account` | `Account` | ✅ | Primary channel for this file (bank/card/wallet). |
| `period` | `{ from: string  null, to: string  null }` | ✅ | Date range covered. |
| `currency` | `string` | optional | ISO 4217 code (default `KRW`). |
| `summary` | `object` | optional | Counts, totals, source metadata. |
| `records` | `TransactionRecord[]` | ✅ | Array of normalized transactions. |

### Account
```ts
 type Account = {
   bank: string;
   holder: string;
   number?: string;
   email?: string;
   channelType?: 'bank' | 'card' | 'wallet' | 'investment' | 'other';
 };
```

## 2. TransactionRecord
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | Unique identifier (`source-prefix + sequence`). |
| `occurredAt` | `{ iso: string, utc: string }` | nullable | Event timestamp (null if unavailable). |
| `confirmedAt` | same as `occurredAt` | optional | Settlement timestamp (cards). |
| `description` | `string` | ✅ | Human-readable description (merchant, memo). |
| `transactionType` | `string` | ✅ | Semantic action (`deposit`, `withdrawal`, `purchase`, `transfer`, `refund`, ...). |
| `institution` | `string` | optional | Institution initiating the transaction. |
| `counterAccount` | `string` | optional | Opposing account/entity. |
| `amount` | `number` | nullable | Signed amount in file currency. Positive = inflow, negative = outflow. |
| `balance` | `number` | nullable | Balance after transaction (if provided). |
| `memo` | `string` | optional | Short comment. |
| `origin` | `string` | optional | `"actual"`, `"forecast"`, `"simulated"`, etc. |
| `matchId` | `string` | optional | Identifier linking mirrored transactions (e.g., transfers). |
| `category` | `string` | optional | Normalized spending/earning category (tax-friendly). |
| `tags` | `string[]` | optional | User-defined or automated labels. |
| `metadata` | `object` | optional | Source-specific structured data. |
| `raw` | `object` | ✅ | Original key-value strings from the source file. |

## 3. JSON Schema
A machine-readable JSON Schema is provided at `schemas/transaction-file.schema.json` for validation.

### Validation expectations
- `occurredAt.iso`/`utc` must be RFC 3339 strings if present.
- `transactionType` should use controlled vocabulary defined in this document.
- `amount` must be signed and reflect inflow/outflow direction consistently.
- `recordVersion` (optional) can be added for future migrations.

## 4. Transaction Type Vocabulary (initial)
| Value | Meaning |
| --- | --- |
| `deposit` | Inbound cash (급여, 환불, 충전 등) |
| `withdrawal` | Outbound cash (현금 인출, 송금) |
| `purchase` | 소비/결제 |
| `transfer` | 계좌 간 이동 |
| `refund` | 취소/환불 |
| `fee` | 수수료 |
| `interest` | 이자수익 |
| `investment_buy` / `investment_sell` | 투자 매수·매도 |
| `others` | 분류 불가 항목 (추가 태깅 필요) |

## 5. Matching & Tags
- `matchId`: 동일 금액·시간대·채널 조합으로 자동 매칭된 상호 거래를 묶는다.
- `origin`: `actual`/`forecast`/`scenario`를 지정해 시뮬레이션과 실제 데이터를 구분.
- `tags`: 예) `['payroll', 'recurring']`, `['transfer', 'self']`, `['tax-deductible']`.

## 6. Schema Versions
- `schemaVersion` follows SemVer. Breaking changes bump major version and require migration instructions.
- Each transaction file should include `schemaVersion` to ensure MCP/API consumers validate correctly.

## 7. Markdown vs Database
- Markdown 문서는 LLM 친화적 요약·분석 용도로 유지하되, 모든 정량 데이터는 DB에 저장한다.
- 리포트/요약(MD)은 DB에서 자동 생성해 일관성을 확보한다.
- LLM은 MD로 맥락을 파악하고, 상세 수치는 DB 기반 API를 호출해 최신 값을 확인한다.

## 7. TODO / Extensions
1. Finalize category taxonomy (e.g., `income.salary`, `expense.utilities`, `asset.transfer`).
2. Define `metadata` sub-structures for 카드/투자/세금 케이스.
3. Create CI job to validate all `data/transactions/**/*.json` against the schema.
4. Document ingestion mapping per source (토스/신한/현대/쿠팡/카카오페이 등).
