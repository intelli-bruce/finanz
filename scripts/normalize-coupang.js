#!/usr/bin/env node
/**
 * Normalize legacy Coupang transaction JSON files into the common transaction schema.
 * Usage: node scripts/normalize-coupang.js <inputPath> [outputPath]
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TZ = '+09:00';

function toRecords(legacyRecords = []) {
  return legacyRecords.map((record, idx) => {
    const amountKRW = record.amountKRW ?? null;
    const amount = amountKRW != null ? -Math.abs(amountKRW) : null;
    return {
      id: record.id || `coupang-${idx + 1}`,
      occurredAt: record.occurredAt || null,
      description: record.productName || record.vendor?.name || '쿠팡 주문',
      transactionType: 'purchase',
      institution: '쿠팡',
      counterAccount: record.vendor?.name || '쿠팡',
      amount,
      balance: null,
      memo: null,
      metadata: {
        productName: record.productName || null,
        vendorName: record.vendor?.name || null,
        vendorBusinessNumber: record.vendor?.businessNumber || null,
        orderNumber: record.orderNumber || null,
        approvalNumber: record.approvalNumber || null,
        pdf: record.pdf || null,
        amountKRW,
      },
      raw: {
        text: record.rawText || '',
      },
    };
  });
}

function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg) {
    console.error('Usage: node scripts/normalize-coupang.js <inputPath> [outputPath]');
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg || inputPath);

  const legacy = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const timezone = legacy.timezone || DEFAULT_TZ;
  const normalized = {
    generatedAt: legacy.generatedAt || new Date().toISOString(),
    sourceFile: Array.isArray(legacy.sourceFiles) ? legacy.sourceFiles[0] || inputPath : legacy.sourceFile || inputPath,
    timezone,
    account: legacy.account || { bank: '쿠팡', holder: '', number: '' },
    period: legacy.period || { from: null, to: null },
    currency: legacy.currency || 'KRW',
    summary: {
      totalRecords: legacy.total || (legacy.records ? legacy.records.length : 0),
      stats: legacy.summary?.stats || null,
      sourceFiles: legacy.sourceFiles || null,
    },
    records: toRecords(legacy.records || []),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2));
  console.log(`✅ Normalized Coupang data saved to ${outputPath}`);
}

main();
