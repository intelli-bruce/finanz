import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const DATA_FILE = path.join(__dirname, '../../data/financial.md');

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

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
