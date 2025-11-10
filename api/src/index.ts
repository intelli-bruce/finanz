import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// 환경 변수 로드
dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const DATA_FILE = path.join(__dirname, '../../data/financial.md');
const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
const DATA_DIR = path.join(__dirname, '../../data');

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
        url: publicUrlData.publicUrl
      };
    });

    res.json({ files: fileList });
  } catch (error: any) {
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

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
