# Finanz

재무 및 세무 정보를 관리하는 시스템입니다. MCP를 통해 Claude와 직접 상호작용하며, 웹 UI를 통한 시각화를 지원합니다.

## 구조

```
finanz/
├── api/          # REST API 서버
├── mcp/          # MCP 서버 (Claude 연동)
├── web/          # 웹 UI (Vite + React)
└── data/         # 마크다운 데이터 저장소
```

## 설치

### 1. API 서버 설치

```bash
cd api
npm install
```

### 2. MCP 서버 설치

```bash
cd mcp
npm install
npm run build
```

### 3. 웹 UI 설치

```bash
cd web
npm install
```

## 사용 방법

### 1. API 서버 실행

```bash
cd api
PORT=3002 npm run dev
```

API 서버가 http://localhost:3002 에서 실행됩니다.

### 2. 웹 UI 실행

```bash
cd web
npm run dev
```

웹 UI가 http://localhost:5173 에서 실행됩니다. 브라우저에서 접속하여 마크다운을 편집할 수 있습니다.

### 3. MCP 서버 설정

Claude Desktop의 설정 파일에 다음을 추가하세요:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "finanz": {
      "command": "node",
      "args": ["/Users/brucechoe/Projects/finanz/mcp/dist/index.js"],
      "env": {
        "FINANZ_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

### 4. Claude Desktop 재시작

설정 후 Claude Desktop을 재시작하면 MCP 서버가 활성화됩니다.

## API 엔드포인트

- `GET /markdown` - 재무 데이터 읽기
- `POST /markdown` - 재무 데이터 쓰기 (전체 덮어쓰기)
- `PATCH /markdown/append` - 재무 데이터에 내용 추가

## MCP Tools

- `read_financial_data` - 재무 데이터 읽기
- `write_financial_data` - 재무 데이터 쓰기
- `append_financial_data` - 재무 데이터에 내용 추가

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

### API 서버
- Node.js + Express
- TypeScript

### MCP 서버
- @modelcontextprotocol/sdk
- Node.js + TypeScript

### 웹 UI
- Vite + React 18
- TypeScript
- Tailwind CSS
- MDXEditor (마크다운 에디터)
- TanStack Query (React Query)
- Axios

## 로드맵

- [x] Phase 1: API + MCP 서버 (마크다운 기반)
- [x] Phase 2: 웹 UI 및 마크다운 에디터
- [ ] Phase 3: 데이터 시각화 (차트, 통계)
- [ ] Phase 4: 데이터베이스 전환 (SQLite/PostgreSQL)
