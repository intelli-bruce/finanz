import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const DEFAULT_POSTGRES_CLI = 'docker exec -i finanz-postgres psql -U postgres -d postgres';

const postgresCli =
  process.env.POSTGRES_PSQL && process.env.POSTGRES_PSQL.trim().length > 0
    ? process.env.POSTGRES_PSQL.trim()
    : DEFAULT_POSTGRES_CLI;

const wrapSqlForJson = (sql: string) =>
  `select coalesce(json_agg(t), '[]'::json) from (${sql}) as t`;

async function runQuery<T>(sql: string): Promise<T[]> {
  const wrapped = wrapSqlForJson(sql);
  const escaped = wrapped.replace(/"/g, '\\"');
  const command = `${postgresCli} -t -A -c "${escaped}"`;
  const { stdout } = await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });
  const jsonMatch = stdout.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    throw new Error(`Postgres 응답을 파싱할 수 없습니다: ${stdout}`);
  }
  return JSON.parse(jsonMatch[0]) as T[];
}

const tolerance = 0.01;

function assertApproxEqual(actual: number, expected: number, context: string) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${context} ⇒ expected ${expected}, got ${actual} (Δ=${diff})`);
  }
}

async function main() {
  const summaries = await runQuery<{
    period_start: string;
    period_end: string;
    assets: number;
    liabilities: number;
    equity: number;
  }>(
    `select period_start::text, period_end::text, assets, liabilities, equity
       from reporting.balance_sheet_monthly_summary
      order by period_start`
  );

  const cashflows = await runQuery<{
    period_start: string;
    period_end: string;
    operating_cash_flow: number;
    investing_cash_flow: number;
    financing_cash_flow: number;
    net_cash_flow: number;
  }>(
    `select period_start::text,
            period_end::text,
            operating_cash_flow,
            investing_cash_flow,
            financing_cash_flow,
            net_cash_flow
       from reporting.cash_flow_monthly
      order by period_start`
  );

const channelBalances = await runQuery<{
  period_start: string;
  period_end: string;
  channel_id: string;
  channel_name: string;
  reporting_role: string;
  closing_balance: number;
}>(
    `select b.period_start::text,
            b.period_end::text,
            r.id::text as channel_id,
            r.name as channel_name,
            r.reporting_role,
            b.closing_balance
       from reporting.balance_sheet_monthly_channel b
       join reporting.channel_roles r on r.id = b.channel_id
      order by b.period_start, r.name`
  );

  const channelActivity = await runQuery<{
    period_start: string;
    channel_id: string;
    amount: number;
  }>(
    `select date_trunc('month', t.occurred_at)::date::text as period_start,
            t.channel_id::text,
            sum(t.amount) as amount
       from public.transactions t
      where t.occurred_at is not null
        and t.channel_id is not null
      group by 1, 2
  order by 1, 2`
);

  const externalMatchRows = await runQuery<{
    period_start: string;
    inflow_diff: number;
    outflow_diff: number;
  }>(
    `select
       cf.period_start::text,
       coalesce(cf.total_inflows, 0) - coalesce(ext.inflows, 0) as inflow_diff,
       coalesce(cf.total_outflows, 0) - coalesce(ext.outflows, 0) as outflow_diff
     from reporting.cash_flow_monthly cf
     left join (
       select
         date_trunc('month', occurred_at)::date as period_start,
         sum(case when amount > 0 then amount else 0 end) as inflows,
         sum(case when amount < 0 then amount else 0 end) as outflows
       from reporting.external_asset_transactions
       group by 1
     ) ext on ext.period_start = cf.period_start`
  );

  const explicitSignViolations = await runQuery<{
    id: string;
    channel_name: string;
    transaction_type: string;
    raw_hint: string | null;
    amount: number;
  }>(
    `select
        t.id::text,
        c.name as channel_name,
        t.transaction_type,
        coalesce(t.raw ->> '거래구분', t.raw ->> '거래 구분', t.raw ->> '구분') as raw_hint,
        t.amount
      from public.transactions t
      join public.channels c on c.id = t.channel_id
     where (
        (t.transaction_type like '[-%' escape '\\' or coalesce(t.raw ->> '거래구분', t.raw ->> '거래 구분', t.raw ->> '구분') like '[-%')
        and t.amount > 0
      )
        or (
        (t.transaction_type like '[+%' escape '\\' or coalesce(t.raw ->> '거래구분', t.raw ->> '거래 구분', t.raw ->> '구분') like '[+%')
        and t.amount < 0
      )`
  );

  if (!summaries.length) {
    throw new Error('balance_sheet_monthly_summary 결과가 없습니다. 보고 뷰를 먼저 생성하세요.');
  }
  if (!cashflows.length) {
    throw new Error('cash_flow_monthly 결과가 없습니다.');
  }
  if (!channelBalances.length) {
    throw new Error('balance_sheet_monthly_channel 결과가 없습니다.');
  }
  if (explicitSignViolations.length) {
    const sample = explicitSignViolations
      .slice(0, 5)
      .map((row) => `${row.channel_name} ${row.transaction_type} (hint=${row.raw_hint ?? 'N/A'}) ⇒ ${row.amount}`)
      .join('\n');
    throw new Error(
      `카카오페이 등 [+]/[-] 힌트와 금액 부호가 일치하지 않는 거래가 ${explicitSignViolations.length}건 있습니다.\n${sample}`
    );
  }

  const periods = summaries.map((row) => row.period_start);
  const cashflowMap = new Map(cashflows.map((row) => [row.period_start, row]));
  const balancesByPeriod = new Map<string, typeof channelBalances>();
  channelBalances.forEach((row) => {
    const list = balancesByPeriod.get(row.period_start) ?? [];
    list.push(row);
    balancesByPeriod.set(row.period_start, list);
  });

  const activityMap = new Map<string, number>();
  channelActivity.forEach((row) => {
    activityMap.set(`${row.channel_id}|${row.period_start}`, row.amount || 0);
  });

  // 1) 매 기간 자산 - 부채 = 자기자본 검증 + summary vs channel sum
  summaries.forEach((summaryRow) => {
    assertApproxEqual(summaryRow.assets - summaryRow.liabilities, summaryRow.equity, `${summaryRow.period_start} 자산-부채=자기자본`);

    const channels = balancesByPeriod.get(summaryRow.period_start) || [];
    const assetsFromChannels = channels
      .filter((c) => c.reporting_role === 'asset')
      .reduce((sum, c) => sum + (c.closing_balance || 0), 0);
    const liabilitiesFromChannels = channels
      .filter((c) => c.reporting_role === 'liability')
      .reduce((sum, c) => sum + (c.closing_balance || 0), 0);

    assertApproxEqual(assetsFromChannels, summaryRow.assets || 0, `${summaryRow.period_start} 자산 합계 일치`);
    assertApproxEqual(liabilitiesFromChannels, summaryRow.liabilities || 0, `${summaryRow.period_start} 부채 합계 일치`);
  });

  // 2) 현금흐름 활동 합계 검증
  cashflows.forEach((row) => {
    const total = (row.operating_cash_flow || 0) + (row.investing_cash_flow || 0) + (row.financing_cash_flow || 0);
    assertApproxEqual(total, row.net_cash_flow || 0, `${row.period_start} 활동별 합계 vs 순현금`);
  });

  // 3) 자산 계정 잔액 증감 == 자산 채널 현금흐름
  const balancesByChannel = new Map<string, typeof channelBalances>();
  channelBalances.forEach((row) => {
    const key = row.channel_id;
    const list = balancesByChannel.get(key) ?? [];
    list.push(row);
    balancesByChannel.set(key, list);
  });
  balancesByChannel.forEach((rows, channelId) => {
    rows.sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const delta = (curr.closing_balance || 0) - (prev.closing_balance || 0);
      const activity = activityMap.get(`${channelId}|${curr.period_start}`) || 0;
      assertApproxEqual(delta, activity, `${curr.period_start} ${curr.channel_name} 잔액 증감 vs 거래합`);
    }
  });

  // 4) 외부 현금 흐름 합계 = cash_flow_monthly 합계 검증
  externalMatchRows.forEach((row) => {
    assertApproxEqual(row.inflow_diff || 0, 0, `${row.period_start} 외부 유입 합계 diff`);
    assertApproxEqual(row.outflow_diff || 0, 0, `${row.period_start} 외부 유출 합계 diff`);
  });

  // 5) 순현금흐름 = 자산잔액 변동(현금성 채널) 검증
  for (let i = 1; i < summaries.length; i += 1) {
    const prev = summaries[i - 1];
    const curr = summaries[i];
    const cashflow = cashflowMap.get(curr.period_start);
    if (!cashflow) {
      throw new Error(`${curr.period_start} 기간의 현금흐름 데이터가 없습니다.`);
    }

    const assetsDelta = (curr.assets || 0) - (prev.assets || 0);
    assertApproxEqual(assetsDelta, cashflow.net_cash_flow || 0, `${curr.period_start} 자산(현금) 증감 vs 순현금`);
  }

  console.log('✅ 보고 뷰 검증 완료: 요약 ↔ 채널 합계, 활동 합계, 외부 흐름 합계, 잔액/거래, 자산-현금 관계 모두 일치');
}

main().catch((err) => {
  console.error('❌ 보고 뷰 검증 실패:', err.message);
  process.exit(1);
});
