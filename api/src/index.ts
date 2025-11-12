import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as XLSX from 'xlsx';

const execPromise = promisify(exec);

const DEFAULT_POSTGRES_CLI = 'docker exec -i finanz-postgres psql -U postgres -d postgres';
const postgresCliCommand =
  process.env.POSTGRES_PSQL === 'disable'
    ? null
    : (process.env.POSTGRES_PSQL && process.env.POSTGRES_PSQL.trim().length > 0
        ? process.env.POSTGRES_PSQL.trim()
        : DEFAULT_POSTGRES_CLI);

const wrapSqlForJson = (sql: string) =>
  `select coalesce(json_agg(t), '[]'::json) from (${sql}) as t`;

async function runReportingQuery<T>(sql: string): Promise<T[]> {
  if (!postgresCliCommand) {
    throw new Error('Postgres CLI command not configured (set POSTGRES_PSQL)');
  }

  const wrappedSql = wrapSqlForJson(sql);
  const escapedSql = wrappedSql.replace(/"/g, '\\"');
  const command = `${postgresCliCommand} -t -A -c "${escapedSql}"`;
  const { stdout } = await execPromise(command);
  const jsonMatch = stdout.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    throw new Error(`Unexpected Postgres output: ${stdout}`);
  }

  return JSON.parse(jsonMatch[0]) as T[];
}

// 환경 변수 로드
dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const DATA_FILE = path.join(__dirname, '../../data/financial.md');
const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
const DATA_DIR = path.join(__dirname, '../../data');
const TRANSACTIONS_DIR = path.join(DATA_DIR, 'transactions');

type TransactionRecord = {
  id?: string;
  occurredAt?: {
    iso?: string | null;
    utc?: string | null;
  } | null;
  description?: string | null;
  transactionType?: string | null;
  institution?: string | null;
  counterAccount?: string | null;
  amount?: number | null;
  balance?: number | null;
  memo?: string | null;
  raw?: Record<string, unknown>;
};

type TransactionFilePayload = {
  generatedAt?: string;
  sourceFile?: string;
  timezone?: string;
  account?: {
    bank?: string | null;
    holder?: string | null;
    number?: string | null;
  };
  period?: {
    from?: string | null;
    to?: string | null;
  };
  currency?: string;
  total?: number;
  records: TransactionRecord[];
};

type MonthlyCashflowRow = {
  period_start: string;
  period_end: string;
  operating_cash_flow: number;
  investing_cash_flow: number;
  financing_cash_flow: number;
  total_inflows: number;
  total_outflows: number;
  net_cash_flow: number;
};

type CashflowBreakdownRow = {
  period_start: string;
  id: string;
  channel_name: string;
  description: string | null;
  amount: number;
  occurred_at: string;
};

type BalanceSheetMonthlySummaryRow = {
  period_start: string;
  period_end: string;
  assets: number;
  liabilities: number;
  equity: number;
};

type BalanceSheetMonthlyChannelRow = {
  period_start: string;
  period_end: string;
  channel_name: string;
  reporting_role: string;
  closing_balance: number;
};

// Supabase 클라이언트 설정
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const BUCKET_NAME = 'finanz-files';

// Multer 설정 - 메모리 스토리지 사용 (Supabase에 업로드하므로 디스크 저장 불필요)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

app.use(cors());
app.use(express.json());

// 마크다운 파일 읽기
app.get('/markdown', async (req: Request, res: Response) => {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf-8');
    res.json({ content });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 마크다운 파일 전체 쓰기 (덮어쓰기)
app.post('/markdown', async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }

    // data 디렉토리가 없으면 생성
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, content, 'utf-8');

    res.json({ success: true, message: 'File written successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 마크다운 파일에 내용 추가
app.patch('/markdown/append', async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }

    // 기존 내용 읽기
    let existingContent = '';
    try {
      existingContent = await fs.readFile(DATA_FILE, 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // 내용 추가
    const newContent = existingContent + '\n' + content;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, newContent, 'utf-8');

    res.json({ success: true, message: 'Content appended successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 거래내역 JSON 조회
app.get('/transactions', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const { data, filePath, relativePath, availableFiles } = await loadTransactionData(query.file);
    const fromDate = parseQueryDate(query.from);
    const toDate = parseQueryDate(query.to);
    const typeFilter = query.type?.trim();
    const searchText = query.q?.trim().toLowerCase();
    const minAmount = query.minAmount ? Number(query.minAmount) : null;
    const maxAmount = query.maxAmount ? Number(query.maxAmount) : null;
    const parsedLimit = query.limit ? Number(query.limit) : NaN;
    const limitNumber = Math.max(
      1,
      Math.min(Number.isNaN(parsedLimit) ? 200 : Math.floor(parsedLimit), 1000)
    );

    let records = [...data.records];

    if (fromDate) {
      records = records.filter((record) => {
        const occurredAt = getRecordDate(record);
        return occurredAt ? occurredAt >= fromDate : false;
      });
    }

    if (toDate) {
      records = records.filter((record) => {
        const occurredAt = getRecordDate(record);
        return occurredAt ? occurredAt <= toDate : false;
      });
    }

    if (typeFilter) {
      records = records.filter(
        (record) => (record.transactionType || '').toLowerCase() === typeFilter.toLowerCase()
      );
    }

    if (searchText) {
      records = records.filter((record) => {
        const target = [
          record.description,
          record.institution,
          record.memo,
          record.counterAccount,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return target.includes(searchText);
      });
    }

    if (minAmount !== null && !Number.isNaN(minAmount)) {
      records = records.filter(
        (record) => typeof record.amount === 'number' && record.amount >= minAmount
      );
    }

    if (maxAmount !== null && !Number.isNaN(maxAmount)) {
      records = records.filter(
        (record) => typeof record.amount === 'number' && record.amount <= maxAmount
      );
    }

    const stats = records.reduce(
      (acc, record) => {
        const amount = typeof record.amount === 'number' ? record.amount : null;
        if (amount !== null) {
          if (amount >= 0) {
            acc.inflow += amount;
          } else {
            acc.outflow += amount;
          }
        }

        const typeKey = record.transactionType || '미지정';
        acc.byType[typeKey] = (acc.byType[typeKey] || 0) + 1;

        return acc;
      },
      {
        inflow: 0,
        outflow: 0,
        byType: {} as Record<string, number>,
      }
    );

    const limitedRecords = records.slice(0, limitNumber);

    res.json({
      source: {
        file: relativePath,
        generatedAt: data.generatedAt,
        timezone: data.timezone,
        period: data.period,
        account: data.account,
        totalInFile: data.records.length,
      },
      filters: {
        file: query.file || null,
        from: fromDate?.toISOString() || null,
        to: toDate?.toISOString() || null,
        type: typeFilter || null,
        q: searchText || null,
        minAmount: minAmount ?? null,
        maxAmount: maxAmount ?? null,
        limit: limitNumber,
      },
      stats,
      matchedRecords: records.length,
      returnedRecords: limitedRecords.length,
      availableFiles,
      records: limitedRecords,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 파일명을 안전한 ASCII 문자로 변환
function sanitizeFilename(filename: string): string {
  // 한글 및 특수문자를 안전한 형식으로 변환
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // 액센트 제거
    .replace(/[^\w\s.-]/g, '') // 영문, 숫자, 공백, 점, 하이픈만 허용
    .replace(/\s+/g, '-') // 공백을 하이픈으로 변경
    .replace(/-+/g, '-') // 연속된 하이픈을 하나로
    .replace(/^-|-$/g, ''); // 시작/끝 하이픈 제거
}

type TransactionFileInfo = {
  name: string;
  relativePath: string;
  path: string;
  size: number;
  updatedAt: string;
  mtimeMs: number;
};

async function listTransactionFilesMetadata(): Promise<TransactionFileInfo[]> {
  async function walk(dir: string, relativeBase: string): Promise<TransactionFileInfo[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: TransactionFileInfo[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const relativePath = path.join(relativeBase, entry.name);

      if (entry.isDirectory()) {
        const nested = await walk(entryPath, relativePath);
        results.push(...nested);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const stats = await fs.stat(entryPath);
      results.push({
        name: entry.name,
        relativePath,
        path: entryPath,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
      });
    }

    return results;
  }

  try {
    const files = await walk(TRANSACTIONS_DIR, '');

    return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function resolveTransactionFilePath(fileName?: string) {
  await fs.mkdir(TRANSACTIONS_DIR, { recursive: true });

  if (fileName) {
    const normalized = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
    const explicitPath = path.join(TRANSACTIONS_DIR, normalized);

    if (!explicitPath.startsWith(TRANSACTIONS_DIR)) {
      throw new Error('허용되지 않은 파일 경로입니다.');
    }

    await fs.access(explicitPath);
    return explicitPath;
  }

  const files = await listTransactionFilesMetadata();
  if (!files.length) {
    throw new Error('거래내역 JSON 파일이 없습니다. 먼저 ingest 스크립트를 실행하세요.');
  }

  return files[0].path;
}

function parseQueryDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function getRecordDate(record: TransactionRecord) {
  const candidate = record.occurredAt?.utc || record.occurredAt?.iso;
  if (!candidate) return null;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

async function loadTransactionData(fileName?: string) {
  const filePath = await resolveTransactionFilePath(fileName);
  const raw = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(raw) as TransactionFilePayload;
  data.records = Array.isArray(data.records) ? data.records : [];
  const files = await listTransactionFilesMetadata();
  const relativePath = path.relative(TRANSACTIONS_DIR, filePath);
  return {
    filePath,
    relativePath,
    data,
    availableFiles: files.map((file) => ({
      name: file.name,
      relativePath: file.relativePath,
      updatedAt: file.updatedAt,
      size: file.size,
    })),
  };
}

// 파일 업로드 - Supabase Storage 사용
app.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 한글 파일명 올바르게 처리
    const originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    // 파일명에 타임스탬프 추가하여 중복 방지
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(originalname);
    const nameWithoutExt = path.basename(originalname, ext);

    // 파일명을 안전한 ASCII 문자로 변환 (한글 제거)
    const safeName = sanitizeFilename(nameWithoutExt) || `file-${uniqueSuffix}`;
    const filename = `${safeName}-${uniqueSuffix}${ext}`;

    // Supabase Storage에 업로드 (원본 파일명을 메타데이터에 저장)
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false,
        metadata: {
          originalName: originalname
        }
      });

    if (error) {
      throw error;
    }

    // 공개 URL 생성
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    // 파일 메타데이터를 데이터베이스에 저장
    const { error: dbError } = await supabase
      .from('file_uploads')
      .insert({
        filename: filename,
        original_name: originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        storage_path: data.path
      });

    if (dbError) {
      console.error('Database insert error:', dbError);
      // Storage에서 업로드된 파일 삭제 (롤백)
      await supabase.storage.from(BUCKET_NAME).remove([filename]);
      throw dbError;
    }

    res.json({
      success: true,
      file: {
        filename: filename,
        originalName: originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: publicUrlData.publicUrl,
        path: data.path
      }
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 업로드된 파일 목록 조회 - 데이터베이스에서 메타데이터 조회
app.get('/files', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('file_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const fileList = data.map((file) => {
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(file.filename);

      return {
        filename: file.filename,
        originalName: file.original_name,
        size: file.size,
        mimetype: file.mimetype,
        created: file.created_at,
        modified: file.updated_at,
        url: publicUrlData.publicUrl,
        tags: file.tags || []
      };
    });

    res.json({ files: fileList });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 파일 메타데이터 업데이트
app.patch('/files/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const { originalName, tags } = req.body;

    console.log('Update request:', { filename, originalName, tags });

    const updateData: any = {
      updated_at: new Date().toISOString()
    };
    if (originalName !== undefined) {
      updateData.original_name = originalName;
    }
    if (tags !== undefined) {
      updateData.tags = tags;
    }

    console.log('Update data:', updateData);

    // DB에서 메타데이터 업데이트
    const { data, error: dbError } = await supabase
      .from('file_uploads')
      .update(updateData)
      .eq('filename', filename)
      .select();

    console.log('Update result:', { data, error: dbError });

    if (dbError) {
      console.error('Database update error:', dbError);
      throw dbError;
    }

    if (!data || data.length === 0) {
      throw new Error('File not found');
    }

    res.json({ success: true, message: 'File metadata updated successfully' });
  } catch (error: any) {
    console.error('Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 파일 삭제 - Storage와 DB에서 모두 삭제
app.delete('/files/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Storage에서 파일 삭제
    const { error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filename]);

    if (storageError) {
      throw storageError;
    }

    // DB에서 메타데이터 삭제
    const { error: dbError } = await supabase
      .from('file_uploads')
      .delete()
      .eq('filename', filename);

    if (dbError) {
      console.error('Database delete error:', dbError);
      throw dbError;
    }

    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 파일 시스템 관리 API (MCP용)
// ============================================

// 경로 검증 헬퍼 - 경로 조작 공격 방지
function validatePath(requestedPath: string): string {
  const fullPath = path.join(DATA_DIR, requestedPath);
  const normalizedPath = path.normalize(fullPath);

  // data 디렉토리 밖으로 나가는지 확인
  if (!normalizedPath.startsWith(DATA_DIR)) {
    throw new Error('Invalid path: Access denied');
  }

  return normalizedPath;
}

// 파일/디렉토리 목록 조회
app.get('/fs/list', async (req: Request, res: Response) => {
  try {
    const { path: requestedPath = '' } = req.query;
    const fullPath = validatePath(requestedPath as string);

    // 디렉토리 존재 확인
    const stats = await fs.stat(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const items = await Promise.all(
      entries.map(async (entry) => {
        const itemPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(itemPath);
        const relativePath = path.relative(DATA_DIR, itemPath);

        return {
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
    );

    res.json({ items });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Directory not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 파일 읽기
app.get('/fs/read', async (req: Request, res: Response) => {
  try {
    const { path: requestedPath } = req.query;

    if (!requestedPath || typeof requestedPath !== 'string') {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = validatePath(requestedPath);
    const content = await fs.readFile(fullPath, 'utf-8');

    res.json({ content, path: requestedPath });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 파일 쓰기 (생성 또는 덮어쓰기)
app.post('/fs/write', async (req: Request, res: Response) => {
  try {
    const { path: requestedPath, content } = req.body;

    if (!requestedPath || typeof requestedPath !== 'string') {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }

    const fullPath = validatePath(requestedPath);

    // 디렉토리 생성 (필요한 경우)
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // 파일 쓰기
    await fs.writeFile(fullPath, content, 'utf-8');

    res.json({
      success: true,
      message: 'File written successfully',
      path: requestedPath
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 파일 삭제
app.delete('/fs/delete', async (req: Request, res: Response) => {
  try {
    const { path: requestedPath } = req.query;

    if (!requestedPath || typeof requestedPath !== 'string') {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = validatePath(requestedPath);

    // 파일인지 디렉토리인지 확인
    const stats = await fs.stat(fullPath);

    if (stats.isDirectory()) {
      // 디렉토리 삭제 (재귀적)
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      // 파일 삭제
      await fs.unlink(fullPath);
    }

    res.json({
      success: true,
      message: 'Deleted successfully',
      path: requestedPath
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File or directory not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 디렉토리 생성
app.post('/fs/mkdir', async (req: Request, res: Response) => {
  try {
    const { path: requestedPath } = req.body;

    if (!requestedPath || typeof requestedPath !== 'string') {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const fullPath = validatePath(requestedPath);

    // 디렉토리 생성 (재귀적)
    await fs.mkdir(fullPath, { recursive: true });

    res.json({
      success: true,
      message: 'Directory created successfully',
      path: requestedPath
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Supabase Storage 파일 접근 API (MCP용)
// ============================================

// 업로드된 파일 메타데이터 조회 (DB에서)
app.get('/storage/files', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('file_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({ files: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Supabase Storage에서 파일 다운로드
app.get('/storage/download/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Storage에서 파일 다운로드
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(filename);

    if (error) {
      throw error;
    }

    // Blob을 텍스트로 변환 (텍스트 파일인 경우)
    const text = await data.text();

    // 파일 메타데이터도 함께 반환
    const { data: metadata } = await supabase
      .from('file_uploads')
      .select('*')
      .eq('filename', filename)
      .single();

    res.json({
      filename,
      content: text,
      metadata: metadata || null
    });
  } catch (error: any) {
    if (error.message?.includes('Object not found')) {
      res.status(404).json({ error: 'File not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 파일이 텍스트인지 확인 (mimetype 기반)
app.get('/storage/info/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    const { data, error } = await supabase
      .from('file_uploads')
      .select('*')
      .eq('filename', filename)
      .single();

    if (error) {
      throw error;
    }

    // 공개 URL 생성
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    res.json({
      ...data,
      url: publicUrlData.publicUrl
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Excel 암호 해제 API
// ============================================

// Excel 파일 암호 해제
app.get('/reports/cashflow/monthly', async (req: Request, res: Response) => {
  if (!postgresCliCommand) {
    return res.status(503).json({ error: 'Postgres reporting은 비활성화되었습니다. POSTGRES_PSQL 환경 변수를 설정하세요.' });
  }

  try {
    const rows = await runReportingQuery<MonthlyCashflowRow>(
      `select
         period_start::text,
         period_end::text,
         operating_cash_flow,
         investing_cash_flow,
         financing_cash_flow,
         total_inflows,
         total_outflows,
         net_cash_flow
       from reporting.cash_flow_monthly
       order by period_start`
    );

    const breakdownRows = await runReportingQuery<CashflowBreakdownRow>(
      `select
         date_trunc('month', t.occurred_at)::date::text as period_start,
         t.id::text,
         cr.name as channel_name,
         coalesce(t.description, '') as description,
         t.amount,
         t.occurred_at::text
       from reporting.external_asset_transactions t
       join reporting.channel_roles cr on cr.id = t.channel_id
       order by period_start, t.occurred_at`
    );

    const breakdown = breakdownRows.reduce<Record<string, CashflowBreakdownRow[]>>((acc, row) => {
      if (!acc[row.period_start]) {
        acc[row.period_start] = [];
      }
      acc[row.period_start].push(row);
      return acc;
    }, {});

    res.json({ rows, breakdown });
  } catch (error: any) {
    console.error('Failed to fetch monthly cash flow', error);
    res.status(500).json({ error: '월별 현금흐름표 조회에 실패했습니다', detail: error?.message });
  }
});

app.get('/reports/balance-sheet/monthly', async (req: Request, res: Response) => {
  if (!postgresCliCommand) {
    return res.status(503).json({ error: 'Postgres reporting은 비활성화되었습니다. POSTGRES_PSQL 환경 변수를 설정하세요.' });
  }

  try {
    const summary = await runReportingQuery<BalanceSheetMonthlySummaryRow>(
      `select period_start::text,
              period_end::text,
              assets,
              liabilities,
              equity
         from reporting.balance_sheet_monthly_summary
        order by period_start`
    );

    const channels = await runReportingQuery<BalanceSheetMonthlyChannelRow>(
      `select b.period_start::text,
              b.period_end::text,
              r.name as channel_name,
              r.reporting_role,
              b.closing_balance
         from reporting.balance_sheet_monthly_channel b
         join reporting.channel_roles r on r.id = b.channel_id
        order by b.period_start, r.reporting_role, r.name`
    );

    res.json({ summary, channels });
  } catch (error: any) {
    console.error('Failed to fetch monthly balance sheet', error);
    res.status(500).json({ error: '월별 대차대조표 조회에 실패했습니다', detail: error?.message });
  }
});

app.post('/decrypt-excel', upload.single('file'), async (req: Request, res: Response) => {
  const tempInputPath = path.join('/tmp', `input-${Date.now()}.xlsx`);
  const tempOutputPath = path.join('/tmp', `output-${Date.now()}.xlsx`);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { password, format = 'xlsx' } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    console.log('Decrypt request:', {
      filename: req.file.originalname,
      size: req.file.size,
      format
    });

    // 임시 파일로 저장
    await fs.writeFile(tempInputPath, req.file.buffer);

    // Python msoffcrypto-tool로 암호 해제
    const decryptCommand = `python3 -c "
import sys
import msoffcrypto

encrypted = open('${tempInputPath}', 'rb')
decrypted = open('${tempOutputPath}', 'wb')

try:
    file = msoffcrypto.OfficeFile(encrypted)
    file.load_key(password='${password.replace(/'/g, "\\'")}')
    file.decrypt(decrypted)
    sys.exit(0)
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
finally:
    encrypted.close()
    decrypted.close()
"`;

    try {
      await execPromise(decryptCommand);
    } catch (error: any) {
      console.error('Decrypt command error:', error.stderr);
      if (error.stderr?.includes('password') || error.stderr?.includes('Invalid') || error.code === 1) {
        await fs.unlink(tempInputPath).catch(() => {});
        await fs.unlink(tempOutputPath).catch(() => {});
        return res.status(401).json({ error: '비밀번호가 올바르지 않거나 암호화되지 않은 파일입니다' });
      }
      throw error;
    }

    // 암호 해제된 파일 읽기
    const decryptedBuffer = await fs.readFile(tempOutputPath);

    if (format === 'csv') {
      // Excel을 CSV로 변환
      const workbook = XLSX.read(decryptedBuffer);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(firstSheet);

      const originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const csvFilename = originalname.replace(/\.xlsx?$/i, '.csv');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(csvFilename)}"`);
      res.send('\uFEFF' + csv); // UTF-8 BOM 추가
    } else {
      // Excel로 반환
      const originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const xlsxFilename = originalname.replace(/\.xlsx?$/i, '_decrypted.xlsx');

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(xlsxFilename)}"`);
      res.send(decryptedBuffer);
    }

    // 임시 파일 삭제
    await fs.unlink(tempInputPath).catch(() => {});
    await fs.unlink(tempOutputPath).catch(() => {});
  } catch (error: any) {
    console.error('Decrypt error:', error);

    // 임시 파일 정리
    await fs.unlink(tempInputPath).catch(() => {});
    await fs.unlink(tempOutputPath).catch(() => {});

    if (error.message?.includes('password')) {
      res.status(401).json({ error: '비밀번호가 올바르지 않습니다' });
    } else {
      res.status(500).json({ error: error.message || '암호 해제에 실패했습니다' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
