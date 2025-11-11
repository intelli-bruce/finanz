#!/usr/bin/env node
/**
 * Normalize legacy NaverPay transaction JSON files into the common transaction schema.
 * Usage: node scripts/normalize-naverpay.js <inputPath> [outputPath]
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TZ = '+09:00';

function ensureTime(value = '00:00:00') {
  if (!value) return '00:00:00';
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return '00:00:00';
}

function toDateObject(dateStr, timeStr = '00:00:00', tz = DEFAULT_TZ) {
  if (!dateStr) return null;
  const safeTime = ensureTime(timeStr);
  const iso = `${dateStr.replace(/\./g, '-')}T${safeTime}${tz}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return { iso, utc: parsed.toISOString() };
}

function toRecords(transactions = [], tz = DEFAULT_TZ) {
  return transactions.map((txn, idx) => {
    const occurredAt = toDateObject(txn.date, txn.time, tz);
    return {
      id: `naverpay-${idx + 1}`,
      occurredAt,
      description: txn.description || '',
      transactionType: txn.type || '',
      institution: '네이버페이',
      counterAccount: txn.description || '',
      amount: typeof txn.amount === 'number' ? txn.amount : null,
      balance: null,
      memo: txn.note || '',
      metadata: {
        note: txn.note || '',
      },
      raw: {
        date: txn.date || '',
        time: txn.time || '',
        description: txn.description || '',
        type: txn.type || '',
        amount: txn.amount ?? '',
        note: txn.note || '',
      },
    };
  });
}

function parsePeriod(value) {
  if (!value) return { from: null, to: null };
  const parts = value.split('~').map((part) => part.trim());
  if (parts.length !== 2) return { from: null, to: null };
  const [from, to] = parts.map((p) => p.replace(/\./g, '-'));
  return { from, to };
}

function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg) {
    console.error('Usage: node scripts/normalize-naverpay.js <inputPath> [outputPath]');
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg || inputArg);

  const legacy = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const timezone = legacy.timezone || DEFAULT_TZ;
  const period = legacy.period && typeof legacy.period === 'string'
    ? parsePeriod(legacy.period)
    : legacy.period || { from: null, to: null };

  const normalized = {
    generatedAt: legacy.generatedAt || new Date().toISOString(),
    sourceFile: legacy.source || inputPath,
    timezone,
    account: legacy.account || {
      bank: '네이버페이',
      holder: '',
      number: '',
    },
    period,
    summary: legacy.summary,
    records: toRecords(legacy.transactions || legacy.records || [], timezone),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2));
  console.log(`✅ Normalized NaverPay data saved to ${outputPath}`);
}

main();
