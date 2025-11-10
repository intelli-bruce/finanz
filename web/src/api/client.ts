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

// 파일 삭제
export const deleteFile = async (filename: string): Promise<void> => {
  await apiClient.delete(`/files/${filename}`);
};

export default apiClient;
