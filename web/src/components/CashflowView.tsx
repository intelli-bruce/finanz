import { Fragment, useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCcw } from 'lucide-react';

import { getMonthlyCashflow, getMonthlyBalanceSheet } from '@/api/client';
import type {
  MonthlyCashflowRow,
  BalanceSheetMonthlySummaryRow,
  CashflowBreakdownEntry,
} from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

type NormalizedCashflowRow = {
  periodStart: string;
  periodEnd: string;
  monthLabel: string;
  operating: number;
  investing: number;
  financing: number;
  inflows: number;
  outflows: number;
  net: number;
};

const formatCurrency = (value: number) => currencyFormatter.format(Math.round(value));
const formatDateTime = (value: string) => dateTimeFormatter.format(new Date(value));

const normalizeRows = (rows?: MonthlyCashflowRow[]): NormalizedCashflowRow[] => {
  if (!rows) return [];

  return [...rows]
    .map((row) => {
      const periodStart = row.period_start;
      const date = new Date(`${periodStart}T00:00:00Z`);

      return {
        periodStart,
        periodEnd: row.period_end,
        monthLabel: monthFormatter.format(date),
        operating: row.operating_cash_flow || 0,
        investing: row.investing_cash_flow || 0,
        financing: row.financing_cash_flow || 0,
        inflows: row.total_inflows || 0,
        outflows: row.total_outflows || 0,
        net: row.net_cash_flow || 0,
      };
    })
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
};

export function CashflowView() {
  const { data: cashflowData, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['reports', 'cashflow', 'monthly'],
    queryFn: getMonthlyCashflow,
  });

  const { data: balanceData } = useQuery({
    queryKey: ['reports', 'balance-sheet', 'summary-for-cashflow'],
    queryFn: async () => {
      const response = await getMonthlyBalanceSheet();
      return response.summary as BalanceSheetMonthlySummaryRow[];
    },
    staleTime: 1000 * 60 * 5,
  });

  const normalized = useMemo(() => normalizeRows(cashflowData?.rows), [cashflowData]);
  const breakdownByPeriod = cashflowData?.breakdown ?? {};
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  useEffect(() => {
    if (normalized.length && !selectedPeriod) {
      setSelectedPeriod(normalized[0].periodStart);
    }
  }, [normalized, selectedPeriod]);

  const summary = useMemo(
    () =>
      normalized.reduce(
        (acc, row) => {
          acc.operating += row.operating;
          acc.investing += row.investing;
          acc.financing += row.financing;
          acc.net += row.net;
          return acc;
        },
        { operating: 0, investing: 0, financing: 0, net: 0 }
      ),
    [normalized]
  );

  const assetsByPeriod = useMemo(() => {
    const map = new Map<string, number>();
    balanceData?.forEach((row) => {
      map.set(row.period_start, row.assets || 0);
    });
    return map;
  }, [balanceData]);

  const fallbackClosingMap = useMemo(() => {
    const asc = [...normalized].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
    const map = new Map<string, number>();
    let running = 0;
    asc.forEach((row) => {
      running += row.net || 0;
      map.set(row.periodStart, running);
    });
    return map;
  }, [normalized]);

  const selectedRow = normalized.find((row) => row.periodStart === selectedPeriod) || normalized[0] || null;
  const closingCash = selectedRow
    ? assetsByPeriod.get(selectedRow.periodStart) ?? fallbackClosingMap.get(selectedRow.periodStart) ?? null
    : null;
  const openingCash = selectedRow && closingCash != null ? closingCash - (selectedRow.net || 0) : null;

  const monthOptions = normalized.map((row) => ({
    value: row.periodStart,
    label: `${row.monthLabel}`,
    range: `${row.periodStart} ~ ${row.periodEnd}`,
  }));

  const sections = selectedRow
    ? [
        {
          title: '영업활동 현금흐름',
          rows: [
            { label: '영업활동 순현금흐름', value: selectedRow.operating },
            { label: '총 유입', value: selectedRow.inflows },
            { label: '총 유출', value: selectedRow.outflows },
          ],
        },
        {
          title: '투자활동 현금흐름',
          rows: [{ label: '투자활동 순현금흐름', value: selectedRow.investing }],
        },
        {
          title: '재무활동 현금흐름',
          rows: [{ label: '재무활동 순현금흐름', value: selectedRow.financing }],
        },
      ]
    : [];

  const inflowEntries: CashflowBreakdownEntry[] = selectedRow
    ? (breakdownByPeriod[selectedRow.periodStart] ?? []).filter((entry) => entry.amount > 0)
    : [];

  const inflowSummary = useMemo(() => {
    const summary = inflowEntries.reduce<Record<string, { channel: string; amount: number }>>((acc, entry) => {
      const existing = acc[entry.channel_name] ?? { channel: entry.channel_name, amount: 0 };
      existing.amount += entry.amount;
      acc[entry.channel_name] = existing;
      return acc;
    }, {});
    return Object.values(summary).sort((a, b) => b.amount - a.amount);
  }, [inflowEntries]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-10">
        <div className="h-8 w-48 rounded-full bg-slate-200" />
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, idx) => (
            <div key={idx} className="h-32 rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="grid gap-4">
          {[...Array(3)].map((_, idx) => (
            <div key={idx} className="h-56 rounded-3xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-20 text-center">
        <AlertCircle className="h-12 w-12 text-rose-500" />
        <div>
          <p className="text-lg font-semibold text-slate-900">현금흐름 데이터를 불러오지 못했습니다.</p>
          <p className="text-sm text-slate-500">Postgres CLI 설정 또는 Docker 컨테이너 상태를 확인한 후 다시 시도하세요.</p>
        </div>
        <Button onClick={() => refetch()} variant="default">
          다시 시도
        </Button>
      </div>
    );
  }

  if (normalized.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-20 text-center">
        <p className="text-lg font-semibold text-slate-900">표시할 현금흐름 데이터가 없습니다.</p>
        <p className="text-sm text-slate-500">거래를 Postgres에 적재한 뒤 다시 조회해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Cashflow Statement</p>
          <h2 className="text-3xl font-bold text-slate-900">현금흐름표</h2>
          <p className="text-sm text-slate-500">reporting.cash_flow_monthly 뷰를 기반으로 계산합니다.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={cn('mr-2 h-4 w-4', isFetching ? 'animate-spin' : '')} />
          새로고침
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          { label: '누적 영업', value: summary.operating },
          { label: '누적 투자', value: summary.investing },
          { label: '누적 재무', value: summary.financing },
          { label: '누적 순현금', value: summary.net },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-100 bg-white/80 px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-slate-400">{item.label}</p>
            <p className="text-lg font-semibold text-slate-900">{formatCurrency(item.value)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-rose-200 bg-white shadow-[0_25px_60px_rgba(241,70,104,0.08)]">
        <div className="border-b border-rose-200 bg-rose-50 text-center py-6">
          <p className="text-2xl font-semibold text-rose-700">현금흐름표</p>
          {selectedRow && (
            <p className="text-sm text-rose-500">{selectedRow.periodStart} ~ {selectedRow.periodEnd}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 p-4">
          <label className="text-xs font-semibold text-slate-500" htmlFor="cashflow-period-select">
            기간 선택
          </label>
          <select
            id="cashflow-period-select"
            className="rounded-md border border-slate-200 px-3 py-1 text-sm"
            value={selectedRow?.periodStart}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            {monthOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.range})
              </option>
            ))}
          </select>
        </div>

        <div className="px-6 pb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2">과목</th>
                <th className="px-4 py-2 text-right">금액 (KRW)</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <Fragment key={section.title}>
                  <tr key={`${section.title}-header`} className="bg-rose-50 text-rose-700">
                    <th className="px-4 py-3 text-left font-semibold">{section.title}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold">금액</th>
                  </tr>
                  {section.rows.map((row) => (
                    <tr key={`${section.title}-${row.label}`}
                      className="border-b border-slate-100">
                      <td className="px-4 py-3 text-slate-700">{row.label}</td>
                      <td className="px-4 py-3 text-right font-mono text-base font-semibold text-slate-900">
                        {formatCurrency(row.value)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}

              {selectedRow && (
                <Fragment key="summary-rows">
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-4 py-3 text-slate-600">현금의 증가</td>
                    <td className="px-4 py-3 text-right font-mono text-base text-slate-900">
                      {formatCurrency(selectedRow.net)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-slate-600">기초 현금</td>
                    <td className="px-4 py-3 text-right font-mono text-base text-slate-900">
                      {openingCash != null ? formatCurrency(openingCash) : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-slate-600">기말 현금</td>
                    <td className="px-4 py-3 text-right font-mono text-base text-slate-900">
                      {closingCash != null ? formatCurrency(closingCash) : '—'}
                    </td>
                  </tr>
                </Fragment>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white">
          <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">채널별 유입 합계</p>
            <span className="text-xs text-slate-400">
              {selectedRow ? `${selectedRow.periodStart} ~ ${selectedRow.periodEnd}` : ''}
            </span>
          </div>
          {inflowSummary.length ? (
            <ul className="divide-y divide-slate-100">
              {inflowSummary.map((item) => (
                <li key={item.channel} className="flex items-center justify-between px-6 py-3 text-sm">
                  <span className="font-semibold text-slate-900">{item.channel}</span>
                  <span className="font-mono text-base font-semibold text-emerald-600">{formatCurrency(item.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-6 text-center text-sm text-slate-500">표시할 유입 채널이 없습니다.</div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white">
          <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">세부 유입 거래</p>
            <span className="text-xs text-slate-400">{inflowEntries.length}건</span>
          </div>
          {inflowEntries.length ? (
            <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {inflowEntries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-6 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900">{entry.channel_name}</p>
                    <p className="text-slate-500">{entry.description || '—'}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(entry.occurred_at)}</p>
                  </div>
                  <div className="text-right font-mono text-base font-semibold text-emerald-600">
                    {formatCurrency(entry.amount)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-6 text-center text-sm text-slate-500">표시할 유입 항목이 없습니다.</div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">※ 금액은 KRW 기준이며, 음수는 유출/감소를 의미합니다.</p>
    </div>
  );
}
