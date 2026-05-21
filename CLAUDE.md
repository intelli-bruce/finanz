# Bruce Wealth OS Vault — Claude Code Instructions

## Identity

Bruce(최종혁) + 인텔리이펙트의 **모든 돈** (Single Source of Truth).
Postgres 거래 DB + Supabase + 마크다운 노트 + PDF 산출물을 한 곳에 통합.

bruce-vault `Finance/` 는 2026-05-03부로 폐지되어 이 프로젝트로 이전됨.

## Quick Start

1. **거래 DB**: PostgreSQL `transactions` (3,700건+, 7 금융채널, 39 카테고리)
2. **마크다운 노트**: `data/{카테고리}/` (Obsidian vault로 등록되어 있어 그래프/링크/dataview 사용 가능)
3. **PDF 산출물**: 견적서, 계약서, 급여명세서, 거래명세표, 발주서 등 동일 폴더에 함께 보관
4. **연말정산**: `연말정산_2025/`

## Vault Structure

```
data/
  ├── transactions/      — 7 금융채널 raw 거래 (기존)
  ├── uploads/           — Supabase Storage 이전 자료 (gitignored)
  ├── links/             — 거래 ↔ 산출물 연결 메타
  ├── payroll/           — 급여관리 + 급여명세서 PDF
  │   └── payslips/      — 급여명세서 PDF (직원별)
  ├── tax/               — 세금계산서, 부가세, 원천징수
  ├── contracts/         — 계약서 PDF
  │   └── nda/           — NDA PDF
  ├── statements/        — 거래명세표 PDF
  ├── orders/            — 발주서 PDF
  ├── quotes/            — 견적서 PDF
  ├── revenue/           — 매출현황 노트
  ├── expenses/          — 지출기록, 가계부, 고정지출
  ├── personal/          — 개인 투자, 환불, 해외결제
  ├── business-info/     — 사업자 정보, 금융 채널 구조, 발행이력
  └── projects/          — 프로젝트별 견적·계약·매출 (회사 자산 + 금액)
      ├── iponoff/
      ├── newscash/
      └── online-settlement/

연말정산_2025/             — 매년 연말정산 자료 (gitignored)
docs/                      — 카테고리 규칙, 분류 문서
schemas/                   — DB 스키마
supabase/                  — Supabase migrations
mcp/, api/, dashboard/, scripts/  — 코드
```

## 보안 원칙 (CRITICAL)

- **PDF + 계약서 + 견적서 + 급여명세서**는 절대 GitHub push 하지 않는다 → `.gitignore`로 차단됨
- 신규 폴더 생성 시 `.gitignore` 동시 갱신 (data/ 하위 모든 새 카테고리는 ignored 기본)
- 마크다운 본문에 직원 주민번호, 계좌번호, 카드번호 평문 금지

## Note Conventions

### Frontmatter (권장)
```yaml
---
type: finance | quote | contract | payroll | tax | invoice | revenue | expense | note
client: <고객사명>      # 거래 관련 시
project: <프로젝트명>   # 프로젝트 관련 시
created: YYYY-MM-DD
amount: <금액>          # 단일 금액 표현 가능 시
currency: KRW | USD
status: draft | sent | confirmed | paid | cancelled
tags: [...]
---
```

### 파일 명명
- 견적서: `<프로젝트>_견적서_<금액or번호>_<YYYY-MM-DD>.pdf` 또는 `견적서_<doc-id>_<날짜>.pdf`
- 거래명세표: `거래명세표_<doc-id>_<YYYY-MM-DD>.pdf`
- 급여명세서: `급여명세서_<이름>_<YYYYMM>.pdf`
- 노트(마크다운): 자유 (한글/영문 혼용 OK)

## Cross-Vault Reference

- bruce-vault: 독서, 건강, 일기, 콘텐츠, 개인 프로젝트 (돈 제외)
- intellieffect-vault: 고객, 미팅, 산출물(비금전), 영업·마케팅
- **돈은 모두 여기 bruce-wealth-os** — bv/iv 어디든 금액 발견 시 이 vault로 이전

## Obsidian Vault 등록

2026-05-03 등록됨. `~/Library/Application Support/obsidian/obsidian.json` vault id `9ec043279189e124`.
첫 열기 시 `.obsidian/` 폴더 자동 생성. Bases 플러그인 활용 가능.

## Agent Permissions

- READ: 전체 vault
- WRITE: `data/`, `docs/` (마크다운 노트)
- MODIFY: frontmatter, 본문 append. 기존 금액 데이터 삭제 금지.
- NO WRITE: `연말정산_*/` (사람이 수동 관리), `schemas/`, `supabase/migrations/`
