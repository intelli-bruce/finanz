import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface MarkdownResponse {
  content: string;
}

export interface MarkdownUpdateRequest {
  content: string;
}

export interface ApiResponse {
  success: boolean;
  message: string;
}

// 마크다운 파일 읽기
export const readMarkdown = async (): Promise<string> => {
  const response = await apiClient.get<MarkdownResponse>('/markdown');
  return response.data.content;
};

// 마크다운 파일 쓰기 (덮어쓰기)
export const writeMarkdown = async (content: string): Promise<void> => {
  await apiClient.post<ApiResponse>('/markdown', { content });
};

// 마크다운 파일에 내용 추가
export const appendMarkdown = async (content: string): Promise<void> => {
  await apiClient.patch<ApiResponse>('/markdown/append', { content });
};

// 파일 관련 타입
export interface UploadedFile {
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  url: string;
  path: string;
}

export interface FileListItem {
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  created: string;
  modified: string;
  url: string;
  tags: string[];
}

// 파일 업로드
export const uploadFile = async (file: File): Promise<UploadedFile> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data.file;
};

// 파일 목록 조회
export const getFiles = async (): Promise<FileListItem[]> => {
  const response = await apiClient.get<{ files: FileListItem[] }>('/files');
  return response.data.files;
};

// 파일 메타데이터 업데이트
export const updateFileMetadata = async (
  filename: string,
  updates: { originalName?: string; tags?: string[] }
): Promise<void> => {
  await apiClient.patch(`/files/${filename}`, updates);
};

// 파일 삭제
export const deleteFile = async (filename: string): Promise<void> => {
  await apiClient.delete(`/files/${filename}`);
};

// ============================================
// 파일 시스템 관리 API
// ============================================

export interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  created: string;
  modified: string;
}

// 파일/디렉토리 목록 조회
export const listFiles = async (path: string = ''): Promise<FileSystemItem[]> => {
  const response = await apiClient.get<{ items: FileSystemItem[] }>(
    `/fs/list?path=${encodeURIComponent(path)}`
  );
  return response.data.items;
};

// 파일 읽기
export const readFile = async (path: string): Promise<string> => {
  const response = await apiClient.get<{ content: string }>(
    `/fs/read?path=${encodeURIComponent(path)}`
  );
  return response.data.content;
};

// 파일 쓰기
export const writeFile = async (path: string, content: string): Promise<void> => {
  await apiClient.post('/fs/write', { path, content });
};

// 파일/디렉토리 삭제
export const deleteFileOrDir = async (path: string): Promise<void> => {
  await apiClient.delete(`/fs/delete?path=${encodeURIComponent(path)}`);
};

// 디렉토리 생성
export const createDirectory = async (path: string): Promise<void> => {
  await apiClient.post('/fs/mkdir', { path });
};

// ============================================
// 보고서 API
// ============================================

export interface MonthlyCashflowRow {
  period_start: string;
  period_end: string;
  operating_cash_flow: number;
  investing_cash_flow: number;
  financing_cash_flow: number;
  total_inflows: number;
  total_outflows: number;
  net_cash_flow: number;
}

export interface CashflowBreakdownEntry {
  period_start: string;
  id: string;
  channel_name: string;
  description: string;
  amount: number;
  occurred_at: string;
}

export interface MonthlyCashflowResponse {
  rows: MonthlyCashflowRow[];
  breakdown: Record<string, CashflowBreakdownEntry[]>;
}

export const getMonthlyCashflow = async (): Promise<MonthlyCashflowResponse> => {
  const response = await apiClient.get<MonthlyCashflowResponse>('/reports/cashflow/monthly');
  return response.data;
};

export interface BalanceSheetMonthlySummaryRow {
  period_start: string;
  period_end: string;
  assets: number;
  liabilities: number;
  equity: number;
}

export interface BalanceSheetMonthlyChannelRow {
  period_start: string;
  period_end: string;
  channel_name: string;
  reporting_role: string;
  closing_balance: number;
}

export const getMonthlyBalanceSheet = async () => {
  const response = await apiClient.get<{
    summary: BalanceSheetMonthlySummaryRow[];
    channels: BalanceSheetMonthlyChannelRow[];
  }>('/reports/balance-sheet/monthly');
  return response.data;
};

export default apiClient;
