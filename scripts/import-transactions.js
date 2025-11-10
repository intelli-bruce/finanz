#!/usr/bin/env node
/**
 * 거래내역 CSV -> JSON 파서
 * 사용 예시:
 *   node scripts/import-transactions.js /path/to/file.csv --out data/transactions/latest.json --tz +09:00
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TZ = '+09:00';

function parseArgs(argv) {
  const args = argv.slice(2);
  let inputPath;
  let outputPath;
  let tz = DEFAULT_TZ;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--') && !inputPath) {
      inputPath = token;
      continue;
    }

    if (token === '--out') {
      outputPath = args[i + 1];
      i += 1;
      continue;
    }

    if (token === '--tz') {
      tz = args[i + 1] || DEFAULT_TZ;
      i += 1;
      continue;
    }
  }

  if (!inputPath) {
    throw new Error('입력 CSV 경로를 인자로 전달하세요. 예) node scripts/import-transactions.js data.csv');
  }

  return {
    inputPath: path.resolve(inputPath),
    outputPath,
    tz
  };
}

function parseCsvLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cols.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cols.push(current);
  return cols.map((value) => value.trim());
}

function removeBom(input) {
  if (!input) return input;
  if (input.charCodeAt(0) === 0xfeff) {
    return input.slice(1);
  }
  return input;
}

function parseCurrency(raw) {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '').replace(/\s+/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isNaN(value) ? null : value;
}

function parseDateTime(raw, tzOffset = DEFAULT_TZ) {
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '-').replace(' ', 'T');
  const iso = `${normalized}${tzOffset}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return {
    iso,
    utc: date.toISOString()
  };
}

function extractMetadata(lines) {
  const meta = {};
  const slice = lines.slice(0, 16);
  slice.forEach((line) => {
    const cells = parseCsvLine(line);
    const key = cells[0];
    if (!key) return;

    if (key.includes('성명')) {
      meta.accountHolder = cells[1] || '';
      return;
    }

    if (key.includes('계좌번호')) {
      meta.accountNumber = cells[1] || '';
      return;
    }

    if (key.includes('조회기간')) {
      const period = (cells[1] || '').split('-').map((part) => part.trim().replace(/\./g, '-'));
      if (period.length === 2) {
        meta.period = {
          from: period[0],
          to: period[1]
        };
      }
    }
  });

  return meta;
}

function buildRecords(lines, headerIndex, tzOffset) {
  const header = parseCsvLine(lines[headerIndex]);
  const dataLines = lines.slice(headerIndex + 1);
  const records = [];

  dataLines.forEach((line, idx) => {
    if (!line || !line.trim()) return;
    const cells = parseCsvLine(line);
    if (!cells[0] || !/\d{4}\.\d{2}\.\d{2}/.test(cells[0])) return;
    const occurredAt = parseDateTime(cells[0], tzOffset);
    const amount = parseCurrency(cells[5]);
    const balance = parseCurrency(cells[6]);

    records.push({
      id: `txn-${idx + 1}`,
      occurredAt,
      description: cells[1] || '',
      transactionType: cells[2] || '',
      institution: cells[3] || '',
      counterAccount: cells[4] || '',
      amount,
      balance,
      memo: cells[7] || '',
      raw: header.reduce((acc, key, colIdx) => {
        acc[key] = cells[colIdx] || '';
        return acc;
      }, {})
    });
  });

  return records;
}

function main() {
  const { inputPath, outputPath, tz } = parseArgs(process.argv);
  const csv = removeBom(fs.readFileSync(inputPath, 'utf8'));
  const lines = csv.split(/\r?\n/);
  const metadata = extractMetadata(lines);
  const headerIndex = lines.findIndex((line) => line.includes('거래 일시') && line.includes('거래 유형'));

  if (headerIndex === -1) {
    throw new Error('헤더 행(거래 일시, 거래 유형 등)을 찾을 수 없습니다. CSV 형식을 확인하세요.');
  }

  const records = buildRecords(lines, headerIndex, tz);

  if (!records.length) {
    console.warn('⚠️  추출된 거래가 없습니다.');
  }

  const first = records[records.length - 1];
  const last = records[0];
  const periodFrom = metadata.period?.from || (first?.occurredAt?.utc || null);
  const periodTo = metadata.period?.to || (last?.occurredAt?.utc || null);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFile: inputPath,
    timezone: tz,
    account: {
      bank: '토스뱅크',
      holder: metadata.accountHolder || null,
      number: metadata.accountNumber || null
    },
    period: {
      from: periodFrom,
      to: periodTo
    },
    total: records.length,
    currency: 'KRW',
    records
  };

  const resolvedOut = path.resolve(
    outputPath
      || path.join(
        process.cwd(),
        'data/transactions',
        `transactions-${(metadata.period?.from || 'unknown').replace(/\s+/g, '')}-${(metadata.period?.to || 'unknown').replace(/\s+/g, '')}.json`
      )
  );

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, JSON.stringify(payload, null, 2));
  console.log(`✅ 거래 ${records.length}건을 ${resolvedOut} 파일로 저장했습니다.`);
}

try {
  main();
} catch (error) {
  console.error('❌ CSV 파싱에 실패했습니다:', error.message);
  process.exitCode = 1;
}
