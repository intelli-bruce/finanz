#!/usr/bin/env node
/**
 * 쿠팡 카드 거래 영수증 PDF -> JSON 변환 스크립트
 * 사용 예시:
 *   npm run ingest:coupang -- --out data/transactions/coupang/2025-01-01_2025-11-10.json \ 
 *     /path/to/coupang-list-0.pdf /path/to/coupang-list-1.pdf
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SWIFT_SCRIPT = path.join(__dirname, 'pdf-text.swift');
const TZ_DEFAULT = '+09:00';

function parseArgs(argv) {
  const args = argv.slice(2);
  const pdfFiles = [];
  let outputPath;
  let timezone = TZ_DEFAULT;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--out') {
      outputPath = args[i + 1];
      i += 1;
      continue;
    }
    if (token === '--tz') {
      timezone = args[i + 1] || TZ_DEFAULT;
      i += 1;
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown option: ${token}`);
    }
    pdfFiles.push(token);
  }

  if (!pdfFiles.length) {
    throw new Error('PDF 파일을 최소 1개 이상 지정하세요.');
  }

  if (!outputPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    outputPath = path.join('data/transactions/coupang', `coupang-${timestamp}.json`);
  }

  return {
    pdfFiles: pdfFiles.map((file) => path.resolve(file)),
    outputPath: path.resolve(outputPath),
    timezone,
  };
}

function extractTextFromPdf(pdfPath) {
  const cacheDir = path.join(os.tmpdir(), 'finanz_swift_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const env = {
    ...process.env,
    SWIFT_MODULE_CACHE_PATH: cacheDir,
    CLANG_MODULE_CACHE_PATH: cacheDir,
  };

  const output = execFileSync('swift', [SWIFT_SCRIPT, pdfPath], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output;
}

function sanitizeNumber(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9\-]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isNaN(value) ? null : value;
}

function parseDateTime(raw, timezone) {
  if (!raw) return null;
  const normalized = raw.trim().replace(/\//g, '-').replace(/\s+/, 'T');
  const iso = `${normalized}${timezone}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return {
    iso,
    utc: date.toISOString(),
  };
}

function findBetween(text, startMarker, endMarkers) {
  const startIndex = text.indexOf(startMarker);
  if (startIndex === -1) {
    return null;
  }
  const start = startIndex + startMarker.length;
  let endIndex = text.length;
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker, start);
    if (idx !== -1 && idx < endIndex) {
      endIndex = idx;
    }
  }
  const segment = text.slice(start, endIndex);
  return segment.replace(/\s+/g, ' ').trim();
}

function parseReceipt(chunk, pdfPath, pageOffset, timezone) {
  const trimmed = chunk.trim();
  if (!trimmed) return null;
  const section = `결제정보\n${trimmed}`;
  const collapsed = section.replace(/[\s]+/g, '');

  const orderNumber = (section.match(/주문번호\s*([0-9]+)/) || [])[1] || null;
  const approvalNumber = (section.match(/승인번호\s*([0-9]+)/) || [])[1] || null;
  const occurredAtRaw = (section.match(/거래일시\s*([0-9/:\s]+)/) || [])[1] || null;
  const vendorName = (section.match(/판매자\s*상호\s*([^\n\r]+)/) || [])[1]?.trim() || null;
  const vendorBizRaw = (section.match(/판매자\s*사업자등록번호\s*([0-9-]+)/) || [])[1] || null;
  const totalAmountRaw = (collapsed.match(/합계금액([0-9,]+)원/) || [])[1] || null;

  const productName = findBetween(section, '상품명', ['과세금', '이용상점정보', '판매자상호', '합계금']);
  const occurredAt = parseDateTime(occurredAtRaw, timezone);
  const totalAmount = sanitizeNumber(totalAmountRaw);

  if (!orderNumber && !approvalNumber && !productName) {
    return null;
  }

  const idBase = orderNumber || approvalNumber || `unknown-${Date.now()}`;
  // Include page number to make ID unique when one order has multiple products
  const uniqueId = `coupang-${idBase}-p${pageOffset}`;

  const amount = totalAmount != null ? -Math.abs(totalAmount) : null;
  return {
    id: uniqueId,
    occurredAt,
    description: productName || vendorName || '쿠팡 주문',
    transactionType: 'purchase',
    institution: '쿠팡',
    counterAccount: vendorName || '쿠팡',
    amount,
    balance: null,
    memo: null,
    metadata: {
      productName: productName || null,
      vendorName: vendorName || null,
      vendorBusinessNumber: vendorBizRaw || null,
      orderNumber: orderNumber || null,
      approvalNumber: approvalNumber || null,
      pdf: {
        file: path.relative(process.cwd(), pdfPath),
        page: pageOffset,
      },
      amountKRW: totalAmount,
    },
    raw: {
      text: section,
    },
  };
}

function parsePdf(pdfPath, timezone) {
  const text = extractTextFromPdf(pdfPath);
  const tokens = text.split(/<<<PAGE\s*(\d+)>>>/);
  const records = [];

  for (let i = 1; i < tokens.length; i += 2) {
    const pageNumber = Number(tokens[i]) || 0;
    const pageText = tokens[i + 1] || '';
    const chunks = pageText.split('결제정보');

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const receipt = parseReceipt(chunk, pdfPath, pageNumber || 1, timezone);
      if (receipt) {
        records.push(receipt);
      }
    }
  }

  return records;
}

function summarize(records) {
  const dates = records
    .map((record) => record.occurredAt?.utc)
    .filter(Boolean)
    .map((value) => new Date(value));

  const from = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
  const to = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  const totalAmount = records.reduce((sum, record) => sum + (record.amount || 0), 0);

  return {
    period: {
      from,
      to,
    },
    stats: {
      totalAmount,
    },
  };
}

function main() {
  const { pdfFiles, outputPath, timezone } = parseArgs(process.argv);

  const allRecords = pdfFiles.flatMap((file) => parsePdf(file, timezone));
  if (!allRecords.length) {
    console.warn('⚠️  변환된 거래가 없습니다.');
  }

  const summary = summarize(allRecords);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFile: pdfFiles[0] || '',
    timezone,
    account: { bank: '쿠팡', holder: '', number: '' },
    period: summary.period,
    currency: 'KRW',
    summary: {
      totalRecords: allRecords.length,
      stats: summary.stats,
      sourceFiles: pdfFiles,
    },
    records: allRecords,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  console.log(`✅ 쿠팡 거래 ${allRecords.length}건을 ${outputPath}에 저장했습니다.`);
}

try {
  main();
} catch (error) {
  console.error('❌ 쿠팡 거래 변환 실패:', error.message);
  process.exit(1);
}
