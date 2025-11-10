#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_URL = process.env.FINANZ_API_URL || 'http://localhost:3000';

// API 호출 헬퍼
async function callAPI(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_URL}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}

// MCP 서버 생성
const server = new Server(
  {
    name: 'finanz-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 사용 가능한 도구 목록
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'read_financial_data',
        description: '재무 데이터 마크다운 파일을 읽습니다.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'write_financial_data',
        description: '재무 데이터 마크다운 파일을 작성합니다 (전체 덮어쓰기).',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: '작성할 마크다운 내용',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'append_financial_data',
        description: '재무 데이터 마크다운 파일에 내용을 추가합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: '추가할 마크다운 내용',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'list_files',
        description: '지정된 디렉토리의 파일 및 폴더 목록을 조회합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '조회할 디렉토리 경로 (data/ 기준 상대 경로, 비어있으면 루트)',
            },
          },
        },
      },
      {
        name: 'read_file',
        description: '지정된 파일의 내용을 읽습니다.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '읽을 파일 경로 (data/ 기준 상대 경로)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: '파일을 생성하거나 덮어씁니다. 필요한 경우 디렉토리도 자동 생성됩니다.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '파일 경로 (data/ 기준 상대 경로)',
            },
            content: {
              type: 'string',
              description: '파일 내용',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'delete_file',
        description: '파일 또는 디렉토리를 삭제합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '삭제할 파일 또는 디렉토리 경로 (data/ 기준 상대 경로)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'create_directory',
        description: '새 디렉토리를 생성합니다. 부모 디렉토리도 자동으로 생성됩니다.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '생성할 디렉토리 경로 (data/ 기준 상대 경로)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_uploaded_files',
        description: 'Supabase Storage에 업로드된 파일 목록을 조회합니다. PDF, 이미지, 문서 등 모든 업로드 파일을 확인할 수 있습니다.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'read_uploaded_file',
        description: 'Supabase Storage에서 업로드된 파일을 다운로드하여 읽습니다. 텍스트 파일(txt, md, json 등)의 내용을 읽을 수 있습니다.',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: '읽을 파일명 (Storage에 저장된 파일명)',
            },
          },
          required: ['filename'],
        },
      },
      {
        name: 'get_uploaded_file_info',
        description: '업로드된 파일의 메타데이터(원본 파일명, 크기, 타입, URL 등)를 조회합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: '조회할 파일명',
            },
          },
          required: ['filename'],
        },
      },
    ],
  };
});

// 도구 실행
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'read_financial_data': {
        const result = await callAPI('/markdown');
        return {
          content: [
            {
              type: 'text',
              text: result.content,
            },
          ],
        };
      }

      case 'write_financial_data': {
        if (!args || typeof args.content !== 'string') {
          throw new Error('content parameter is required');
        }

        await callAPI('/markdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: args.content }),
        });

        return {
          content: [
            {
              type: 'text',
              text: '파일이 성공적으로 작성되었습니다.',
            },
          ],
        };
      }

      case 'append_financial_data': {
        if (!args || typeof args.content !== 'string') {
          throw new Error('content parameter is required');
        }

        await callAPI('/markdown/append', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: args.content }),
        });

        return {
          content: [
            {
              type: 'text',
              text: '내용이 성공적으로 추가되었습니다.',
            },
          ],
        };
      }

      case 'list_files': {
        const pathParam = (args?.path as string) || '';
        const result = await callAPI(`/fs/list?path=${encodeURIComponent(pathParam)}`);

        const items = result.items.map((item: any) => {
          const type = item.type === 'directory' ? '📁' : '📄';
          return `${type} ${item.name} (${item.path})`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: items || '디렉토리가 비어있습니다.',
            },
          ],
        };
      }

      case 'read_file': {
        if (!args || typeof args.path !== 'string') {
          throw new Error('path parameter is required');
        }

        const result = await callAPI(`/fs/read?path=${encodeURIComponent(args.path)}`);

        return {
          content: [
            {
              type: 'text',
              text: result.content,
            },
          ],
        };
      }

      case 'write_file': {
        if (!args || typeof args.path !== 'string' || typeof args.content !== 'string') {
          throw new Error('path and content parameters are required');
        }

        await callAPI('/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: args.path, content: args.content }),
        });

        return {
          content: [
            {
              type: 'text',
              text: `파일이 성공적으로 작성되었습니다: ${args.path}`,
            },
          ],
        };
      }

      case 'delete_file': {
        if (!args || typeof args.path !== 'string') {
          throw new Error('path parameter is required');
        }

        await callAPI(`/fs/delete?path=${encodeURIComponent(args.path)}`, {
          method: 'DELETE',
        });

        return {
          content: [
            {
              type: 'text',
              text: `삭제되었습니다: ${args.path}`,
            },
          ],
        };
      }

      case 'create_directory': {
        if (!args || typeof args.path !== 'string') {
          throw new Error('path parameter is required');
        }

        await callAPI('/fs/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: args.path }),
        });

        return {
          content: [
            {
              type: 'text',
              text: `디렉토리가 생성되었습니다: ${args.path}`,
            },
          ],
        };
      }

      case 'list_uploaded_files': {
        const result = await callAPI('/storage/files');

        if (!result.files || result.files.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: '업로드된 파일이 없습니다.',
              },
            ],
          };
        }

        const fileList = result.files
          .map((file: any) => {
            const size = (file.size / 1024).toFixed(2);
            return `📎 ${file.original_name}\n   파일명: ${file.filename}\n   크기: ${size}KB\n   타입: ${file.mimetype}\n   업로드: ${new Date(file.created_at).toLocaleString('ko-KR')}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `업로드된 파일 목록 (총 ${result.files.length}개):\n\n${fileList}`,
            },
          ],
        };
      }

      case 'read_uploaded_file': {
        if (!args || typeof args.filename !== 'string') {
          throw new Error('filename parameter is required');
        }

        const result = await callAPI(`/storage/download/${encodeURIComponent(args.filename)}`);

        const metadata = result.metadata
          ? `\n\n[파일 정보]\n원본 파일명: ${result.metadata.original_name}\n크기: ${(result.metadata.size / 1024).toFixed(2)}KB\n타입: ${result.metadata.mimetype}`
          : '';

        return {
          content: [
            {
              type: 'text',
              text: `${result.content}${metadata}`,
            },
          ],
        };
      }

      case 'get_uploaded_file_info': {
        if (!args || typeof args.filename !== 'string') {
          throw new Error('filename parameter is required');
        }

        const result = await callAPI(`/storage/info/${encodeURIComponent(args.filename)}`);

        const info = `파일 정보:
원본 파일명: ${result.original_name}
저장된 파일명: ${result.filename}
크기: ${(result.size / 1024).toFixed(2)}KB
타입: ${result.mimetype}
업로드 일시: ${new Date(result.created_at).toLocaleString('ko-KR')}
URL: ${result.url}`;

        return {
          content: [
            {
              type: 'text',
              text: info,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// 서버 시작
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Finanz MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
