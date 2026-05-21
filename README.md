# Bruce Wealth OS

재무 및 세무 정보를 관리하는 시스템입니다. MCP를 통해 Claude와 직접 상호작용하며, 웹 UI를 통한 시각화를 지원합니다.

## 구조

```
bruce-wealth-os/
├── api/          # REST API 서버 (Express)
├── mcp/          # MCP 서버 (Claude 연동)
├── web/          # 웹 UI (Vite + React)
└── data/         # 마크다운 데이터 저장소
```

## 설치

이 프로젝트는 **npm workspaces**를 사용하는 monorepo 구조입니다.

### 1. 전체 프로젝트 설치 (권장)

루트 디렉토리에서 한 번에 모든 워크스페이스 설치:

```bash
npm install
```

### 2. 개별 워크스페이스 설치 (선택사항)

```bash
# API 서버만 설치
npm install --workspace=api

# 웹 UI만 설치
npm install --workspace=web
```

## 환경 변수 설정

API 서버 실행 전에 환경 변수를 설정해야 합니다.

`api/.env` 파일 생성:

```env
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
PORT=3002
# Postgres 보고용 CLI 경로 (선택)
# docker 컨테이너를 사용 중이면 기본값을 그대로 둬도 됩니다.
# POSTGRES_PSQL="docker exec -i bruce-wealth-os-postgres psql -U postgres -d postgres"
```

## 사용 방법

### 1. 개발 서버 실행

#### 모든 서버 동시 실행

```bash
npm run dev
```

#### 개별 실행

```bash
# API 서버만 실행
npm run dev:api

# 웹 UI만 실행
npm run dev:web
```

- API 서버: http://localhost:3002
- 웹 UI: http://localhost:5173

### 2. 빌드

```bash
# 모든 워크스페이스 빌드
npm run build

# 개별 빌드
npm run build:api
npm run build:web
```

### 3. MCP 서버 설정

Claude Desktop의 설정 파일에 다음을 추가하세요:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bruce-wealth-os": {
      "command": "node",
      "args": ["/Volumes/WorkSSD/Projects/bruce-wealth-os/mcp/dist/index.js"],
      "env": {
        "BRUCE_WEALTH_OS_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

### 4. Claude Desktop 재시작

설정 후 Claude Desktop을 재시작하면 MCP 서버가 활성화됩니다.

### 5. CSV 거래내역 가져오기

토스뱅크 등에서 내려받은 CSV를 `data/transactions/*.json`으로 변환해 API/LLM이 사용하도록 합니다.

```bash
# 기본 사용: data/transactions/transactions-조회기간.json 으로 저장
npm run ingest:transactions -- /path/to/transactions.csv

# 출력 경로·타임존 지정 예시 (기관별 하위 디렉토리 권장)
npm run ingest:transactions -- /path/to/transactions.csv --out data/transactions/tossbank/2025-01-01_2025-11-10.json --tz +09:00

# 쿠팡 카드 영수증 PDF → JSON
npm run ingest:coupang -- --out data/transactions/coupang/2025-01-01_2025-11-10.json \\
  /path/to/coupang-list-0.pdf /path/to/coupang-list-1.pdf
```

생성된 JSON은 `/transactions` API와 MCP `list_transactions` tool에서 바로 활용됩니다.

### Transaction JSON Schema

모든 `data/transactions/**` JSON은 다음 공통 스키마를 따릅니다.

```ts
type TransactionFile = {
  generatedAt: string;
  sourceFile: string;
  timezone: string;
  account: {
    bank: string;
    holder: string;
    number?: string;
    email?: string;
  };
  period: { from: string | null; to: string | null };
  summary?: Record<string, unknown>;
  records: TransactionRecord[];
};

type TransactionRecord = {
  id: string;
  occurredAt: { iso: string; utc: string } | null;
  confirmedAt?: { iso: string; utc: string } | null;
  description: string;
  transactionType: string;
  institution?: string;
  counterAccount?: string;
  amount: number | null;
  balance: number | null;
  memo?: string;
  metadata?: Record<string, unknown>;
  raw: Record<string, string | number>;
};
```

`scripts/normalize-naverpay.js` 는 기존 네이버페이 JSON을 위 스키마에 맞게 변환하는 도구입니다. 새로운 소스가 추가될 경우 동일 스키마만 지켜도 `/transactions` API가 그대로 동작합니다.

📄 **자금 흐름 구조/기능 요구사항**은 `docs/financial-flow-requirements.md`에서 확인할 수 있습니다. 9가지 핵심 기능(자금 흐름 추적, 채널 객체화, 중복 감지, 시각화, 인컴 소스·시뮬레이션, 투자 추적, LLM 조언 등)에 필요한 구조와 모듈 요구사항을 정리해 두었으니, 기능 개발 전에 반드시 참고하세요.

📐 **JSON Schema**: `schemas/transaction-file.schema.json`에 머신 검증용 스키마를 제공하므로, 신규 거래 JSON을 추가하기 전 `npx ajv validate -s schemas/transaction-file.schema.json -d data/transactions/<file>.json` 등으로 확인하세요.

🗄️ **Database Schema**: 장기적으로는 PostgreSQL이 거래의 단일 소스가 됩니다. 초안 DDL과 테이블 관계는 `docs/db-schema.md`를 참고하세요.

📊 **Financial Reporting Views**: `scripts/sql/reporting_financial_statements.sql`을 적용하면 `reporting` 스키마에 월별/분기별/반기별 대차대조표와 월별 현금흐름표 뷰가 생성됩니다. 실행 순서와 커스터마이징 방법은 `docs/financial-reporting.md`를 참고하세요. 웹 UI 하단 Dock의 **Cashflow** / **Balance Sheet** 탭이 각각 `/reports/cashflow/monthly`, `/reports/balance-sheet/monthly` API를 호출해 데이터를 시각화합니다.

🧪 **보고 뷰 검증**: `npm run test:reports` 명령은 Postgres reporting 뷰를 조회해 아래를 자동 검증합니다.
  1. 모든 기간에 대해 `자산 - 부채 = 자기자본`
  2. 각 월의 순자산 변동 = 해당 월 `net_cash_flow`
  3. 전체 기간 누적 순현금흐름 = 최초 대비 최신 순자산 변동
  실패 시 에러 메시지와 함께 어떤 월/항목이 어긋나는지 표시하므로, ingest 파이프라인이나 채널 메타데이터를 수정한 뒤 꼭 실행하세요.

## API 엔드포인트

### 마크다운 관리
- `GET /markdown` - 재무 데이터 읽기
- `POST /markdown` - 재무 데이터 쓰기 (전체 덮어쓰기)
- `PATCH /markdown/append` - 재무 데이터에 내용 추가

### 파일 업로드 (Supabase Storage)
- `POST /upload` - 파일 업로드
- `GET /files` - 업로드된 파일 목록 조회
- `DELETE /files/:filename` - 파일 삭제

### 파일 시스템 관리 (MCP용)
- `GET /fs/list` - 파일/디렉토리 목록 조회
- `GET /fs/read` - 파일 읽기
- `POST /fs/write` - 파일 쓰기
- `DELETE /fs/delete` - 파일/디렉토리 삭제
- `POST /fs/mkdir` - 디렉토리 생성

### Supabase Storage 접근 (MCP용)
- `GET /storage/files` - 업로드된 파일 메타데이터 목록
- `GET /storage/download/:filename` - 파일 다운로드 및 읽기
- `GET /storage/info/:filename` - 파일 정보 조회

### 거래 내역
- `GET /transactions` - 최신 혹은 `file`로 지정한 거래 JSON을 로드해 날짜/유형/금액/키워드로 필터링하고, 요약 통계와 함께 최대 1000건까지 반환합니다. `file`은 `data/transactions/` 기준 상대 경로(예: `tossbank/2025-01-01_2025-11-10.json`)를 받습니다. 지원 파라미터: `from`, `to`, `type`, `q`, `minAmount`, `maxAmount`, `limit`, `file`.

## MCP Tools

### 기존 재무 데이터 관리
- `read_financial_data` - 재무 데이터 읽기
- `write_financial_data` - 재무 데이터 쓰기
- `append_financial_data` - 재무 데이터에 내용 추가

### 파일 시스템 관리
- `list_files` - 파일 및 디렉토리 목록 조회
- `read_file` - 특정 파일 읽기
- `write_file` - 파일 생성 또는 덮어쓰기
- `delete_file` - 파일 또는 디렉토리 삭제
- `create_directory` - 디렉토리 생성

### Supabase Storage 관리
- `list_uploaded_files` - 업로드된 파일 목록 조회
- `read_uploaded_file` - 업로드된 파일 다운로드 및 읽기
- `get_uploaded_file_info` - 파일 메타데이터 조회

### 거래 내역
- `list_transactions` - `/transactions` API를 호출해 기간·유형·검색어·금액 필터를 적용한 거래 목록과 요약 통계를 반환합니다. `file` 파라미터는 `data/transactions/` 상대 경로를 그대로 사용하세요.

## 데이터 형식

`data/financial.md` 파일에 마크다운 형식으로 데이터가 저장됩니다.

예시:

```markdown
# 재무 정보

## 프로필
- 이름: 홍길동
- 직업: 프리랜서 개발자
- 사업 시작일: 2020-01-01

## 수입
- 2024-01-15: 프로젝트 A - 5,000,000원
- 2024-02-20: 프로젝트 B - 3,000,000원

## 지출
- 2024-01-10: 노트북 구매 - 2,000,000원
```

## 기술 스택

### Monorepo
- npm workspaces

### API 서버
- Node.js + Express
- TypeScript
- Supabase Storage (파일 업로드)
- Multer (파일 처리)

### MCP 서버
- @modelcontextprotocol/sdk
- Node.js + TypeScript

### 웹 UI
- Vite + React 19
- TypeScript
- Tailwind CSS
- MDXEditor (마크다운 에디터)
- TanStack Query (React Query)
- Axios

### 인프라
- Supabase (Storage)

## 로드맵

- [x] Phase 1: API + MCP 서버 (마크다운 기반)
- [x] Phase 2: 웹 UI 및 마크다운 에디터
- [x] Phase 3: 파일 업로드 기능 (Supabase Storage)
- [ ] Phase 4: 데이터 시각화 (차트, 통계)
- [ ] Phase 5: 데이터베이스 전환 (Supabase DB)
