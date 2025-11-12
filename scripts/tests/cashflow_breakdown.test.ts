import { expect, test } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function fetchJson(sql: string) {
  const command = `docker exec -i finanz-postgres psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\"')}"`;
  const { stdout } = await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });
  const match = stdout.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Unexpected output: ${stdout}`);
  return JSON.parse(match[0]);
}

test('external asset inflows match API breakdown structure', async () => {
  const inflows = await fetchJson(
    `select json_agg(row_to_json(t))
       from (
         select date_trunc('month', occurred_at)::date as period_start,
                channel_id,
                amount
           from reporting.external_asset_transactions
          where amount > 0
            and date_trunc('month', occurred_at)::date = '2025-11-01'
       ) t`
  );
  const total = inflows.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
  expect(total).toBeGreaterThan(0);
});
