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
