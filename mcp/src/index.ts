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
