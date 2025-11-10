import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

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

export default apiClient;
