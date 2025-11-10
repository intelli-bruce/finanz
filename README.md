# Finanz

재무 및 세무 정보를 관리하는 시스템입니다. MCP를 통해 Claude와 직접 상호작용하며, 웹 UI를 통한 시각화를 지원합니다.

## 구조

```
finanz/
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
