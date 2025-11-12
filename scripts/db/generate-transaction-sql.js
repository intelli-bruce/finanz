#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dir: 'data/transactions',
    output: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--dir') {
      options.dir = args[i + 1];
      i += 1;
      continue;
    }
    if (token === '--out' || token === '--output') {
      options.output = args[i + 1];
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      console.log('Usage: node scripts/db/generate-transaction-sql.js [--dir data/transactions] [--out dump.sql]');
      process.exit(0);
    }
  }

  return options;
}

function listJsonFiles(rootDir) {
  const results = [];
  function walk(current) {
    const stats = fs.statSync(current);
    if (stats.isDirectory()) {
      const entries = fs.readdirSync(current);
      entries.forEach((entry) => walk(path.join(current, entry)));
      return;
    }
    if (stats.isFile() && current.endsWith('.json')) {
      results.push(current);
    }
  }

  walk(rootDir);
  return results.sort();
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractExplicitSign(record) {
  const hints = [];
  const candidates = [];
  if (typeof record.transactionType === 'string') {
    candidates.push(record.transactionType);
  }
  const raw = record.raw || {};
  ['거래구분', '거래 구분', '구분'].forEach((key) => {
    if (typeof raw[key] === 'string') {
      candidates.push(raw[key]);
    }
  });

  candidates.forEach((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('[-')) {
      hints.push(-1);
    } else if (trimmed.startsWith('[+')) {
      hints.push(1);
    }
  });

  const hasPositive = hints.includes(1);
  const hasNegative = hints.includes(-1);
  if (hasPositive && !hasNegative) return 1;
  if (hasNegative && !hasPositive) return -1;
  return 0;
}

function normalizeAmount(record) {
  const numeric = toNumber(record.amount);
  if (numeric === null) return null;
  if (numeric === 0) return 0;
  const desiredSign = extractExplicitSign(record);
  if (!desiredSign) return numeric;
  const currentSign = numeric > 0 ? 1 : -1;
  if (currentSign === desiredSign) return numeric;
  return Math.abs(numeric) * desiredSign;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

function sqlJson(value) {
  if (value === null || value === undefined) return 'NULL';
  const json = JSON.stringify(value).replace(/'/g, "''");
  return `'${json}'::jsonb`;
}

function sqlArray(value) {
  if (!Array.isArray(value) || value.length === 0) return 'NULL';
  const escaped = value.map((item) => (item ?? '').toString().replace(/"/g, '\\"'));
  return `ARRAY["${escaped.join('","')}"]::text[]`;
}

function toTimestamp(value) {
  if (!value) return 'NULL';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'NULL';
  return `'${date.toISOString()}'::timestamptz`;
}

function buildChannelExternalId(account = {}, fallback) {
  const bank = account.bank || 'unknown';
  const identifier = account.number || account.email || fallback || '';
  return `${bank}:${identifier}`;
}

function generateSqlForFile(filePath, json) {
  const relPath = path.relative(process.cwd(), filePath);
  const account = json.account || {};
  const channelType = account.channelType || 'bank';
  const channelExternalId = buildChannelExternalId(account, relPath);
  const channelNameParts = [account.bank, account.number || account.email]
    .filter(Boolean)
    .join(' ');
  const channelName = channelNameParts || account.bank || account.holder || 'Unknown Channel';

  const schemaVersion = json.schemaVersion || '1.0.0';
  const timezone = json.timezone || '+00:00';
  const currency = json.currency || 'KRW';
  const periodFrom = toTimestamp(json.period?.from);
  const periodTo = toTimestamp(json.period?.to);
  const summaryJson = sqlJson(json.summary);

  const sourceFile = json.sourceFile || relPath;

  const channelInsert = `INSERT INTO channels (
    external_id, name, type, bank, masked_number, owner, metadata
  ) VALUES (
    ${sqlLiteral(channelExternalId)},
    ${sqlLiteral(channelName)},
    ${sqlLiteral(channelType)},
    ${sqlLiteral(account.bank || null)},
    ${sqlLiteral(account.number || null)},
    ${sqlLiteral(account.holder || null)},
    ${sqlJson({ sourceFile: relPath })}
  )
  ON CONFLICT (external_id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    bank = EXCLUDED.bank,
    masked_number = EXCLUDED.masked_number,
    owner = EXCLUDED.owner,
    metadata = EXCLUDED.metadata
  RETURNING id INTO v_channel_id;`;

  const fileInsert = `INSERT INTO transaction_files (
    schema_version, source_file, timezone, currency,
    account_bank, account_holder, account_number, account_email,
    channel_type, period_from, period_to, summary
  ) VALUES (
    ${sqlLiteral(schemaVersion)},
    ${sqlLiteral(sourceFile)},
    ${sqlLiteral(timezone)},
    ${sqlLiteral(currency)},
    ${sqlLiteral(account.bank || 'Unknown')},
    ${sqlLiteral(account.holder || '')},
    ${sqlLiteral(account.number || null)},
    ${sqlLiteral(account.email || null)},
    ${sqlLiteral(channelType)},
    ${periodFrom},
    ${periodTo},
    ${summaryJson}
  )
  ON CONFLICT (source_file) DO UPDATE SET
    schema_version = EXCLUDED.schema_version,
    timezone = EXCLUDED.timezone,
    currency = EXCLUDED.currency,
    account_bank = EXCLUDED.account_bank,
    account_holder = EXCLUDED.account_holder,
    account_number = EXCLUDED.account_number,
    account_email = EXCLUDED.account_email,
    channel_type = EXCLUDED.channel_type,
    period_from = EXCLUDED.period_from,
    period_to = EXCLUDED.period_to,
    summary = EXCLUDED.summary
  RETURNING id INTO v_file_id;`;

  const records = Array.isArray(json.records)
    ? json.records
    : Array.isArray(json.transactions)
      ? json.transactions
      : [];
  if (!records.length) {
    return `-- ${relPath}\n-- No records to insert.\n`;
  }

  const values = records.map((record) => {
    const occurredAt = toTimestamp(record.occurredAt?.utc || record.occurredAt?.iso);
    const confirmedAt = toTimestamp(record.confirmedAt?.utc || record.confirmedAt?.iso);
    const normalizedAmount = normalizeAmount(record);
    const amount = normalizedAmount == null ? 'NULL' : normalizedAmount;
    const balance = record.balance == null ? 'NULL' : record.balance;
    const tags = sqlArray(record.tags);
    const metadata = sqlJson(record.metadata);
    const raw = sqlJson(record.raw);
    return `(
      v_file_id,
      v_channel_id,
      NULL,
      ${sqlLiteral(record.id)},
      ${occurredAt},
      ${confirmedAt},
      ${sqlLiteral(record.description || '')},
      ${sqlLiteral(record.transactionType || 'unknown')},
      ${amount},
      ${balance},
      ${sqlLiteral(record.memo || null)},
      ${sqlLiteral(record.origin || 'actual')},
      ${sqlLiteral(record.matchId || null)},
      ${sqlLiteral(record.category || null)},
      ${tags},
      ${metadata},
      ${raw}
    )`;
  });

  const insertTransactions = `INSERT INTO transactions (
    file_id, channel_id, counter_channel_id,
    record_id, occurred_at, confirmed_at,
    description, transaction_type,
    amount, balance,
    memo, origin, match_id, category, tags,
    metadata, raw
  ) VALUES
  ${values.join(',\n  ')}
  ON CONFLICT (file_id, record_id) DO NOTHING;`;

  return `-- ${relPath}
DO $$
DECLARE
  v_file_id uuid;
  v_channel_id uuid;
BEGIN
  SELECT id INTO v_channel_id FROM channels WHERE external_id = ${sqlLiteral(channelExternalId)};
  IF v_channel_id IS NULL THEN
    ${channelInsert}
  END IF;

  SELECT id INTO v_file_id FROM transaction_files WHERE source_file = ${sqlLiteral(sourceFile)};
  IF v_file_id IS NULL THEN
    ${fileInsert}
  END IF;

  ${insertTransactions}
END$$;
`;
}

function main() {
  const { dir, output } = parseArgs();
  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }

  const files = listJsonFiles(absDir);
  if (!files.length) {
    console.error('No JSON files found.');
    process.exit(1);
  }

  const sqlChunks = files.map((filePath) => {
    const raw = fs.readFileSync(filePath, 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.error(`Failed to parse JSON: ${filePath}`);
      throw error;
    }
    return generateSqlForFile(filePath, json);
  });

  const sql = sqlChunks.join('\n');
  if (output) {
    fs.writeFileSync(output, sql, 'utf8');
    console.log(`SQL dumped to ${output}`);
    return;
  }

  process.stdout.write(sql);
}

main();
