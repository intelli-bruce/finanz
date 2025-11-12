import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCcw, Scale } from 'lucide-react';

import {
  getMonthlyBalanceSheet,
  type BalanceSheetMonthlySummaryRow,
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
  month: 'short',
});

type SummaryRowKey = keyof Pick<BalanceSheetMonthlySummaryRow, 'assets' | 'liabilities' | 'equity'>;

type ChannelByRole = Record<
  string,
  Array<{
    channel: string;
    values: Record<string, number>;
  }>
>;

const formatCurrency = (value: number) => currencyFormatter.format(Math.round(value));

export function BalanceSheetView() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['reports', 'balance-sheet', 'monthly'],
    queryFn: getMonthlyBalanceSheet,
  });

  const summary = data?.summary ?? [];
  const months = useMemo(() => {
    return [...summary]
      .map((row) => ({
        periodStart: row.period_start,
        periodEnd: row.period_end,
        label: monthFormatter.format(new Date(`${row.period_start}T00:00:00Z`)),
      }))
      .sort((a, b) => (a.periodStart > b.periodStart ? 1 : -1));
  }, [summary]);

  const summaryRows: { label: string; key: SummaryRowKey }[] = [
    { label: '총 자산', key: 'assets' },
    { label: '총 부채', key: 'liabilities' },
    { label: '자기자본', key: 'equity' },
  ];

  const channelsByRole = useMemo(() => {
    const grouped: ChannelByRole = {};
    if (!data?.channels) return grouped;

    data.channels.forEach((row) => {
      if (!grouped[row.reporting_role]) {
        grouped[row.reporting_role] = [];
      }
    });

    const keys = Object.keys(grouped);
    data.channels.forEach((row) => {
      const bucket = grouped[row.reporting_role];
      if (!bucket) return;
      let entry = bucket.find((item) => item.channel === row.channel_name);
      if (!entry) {
        entry = { channel: row.channel_name, values: {} };
        bucket.push(entry);
      }
      entry.values[row.period_start] = row.closing_balance || 0;
    });

    keys.forEach((role) => {
      grouped[role] = grouped[role]
        .map((item) => ({
          channel: item.channel,
          values: item.values,
        }))
        .sort((a, b) => {
          const lastPeriod = months.at(-1)?.periodStart;
          const aValue = lastPeriod ? Math.abs(a.values[lastPeriod] ?? 0) : 0;
          const bValue = lastPeriod ? Math.abs(b.values[lastPeriod] ?? 0) : 0;
          return bValue - aValue;
        });
    });

    return grouped;
  }, [data?.channels, months]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-10">
        <div className="h-8 w-48 rounded-full bg-slate-200" />
        <div className="h-40 rounded-2xl bg-slate-100" />
        <div className="h-72 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-20 text-center">
        <AlertCircle className="h-12 w-12 text-rose-500" />
        <div>
          <p className="text-lg font-semibold text-slate-900">대차대조표 데이터를 불러오지 못했습니다.</p>
          <p className="text-sm text-slate-500">Postgres reporting 뷰 적용 여부와 API 로그를 확인해 주세요.</p>
        </div>
        <Button onClick={() => refetch()} variant="default">
          다시 시도
        </Button>
      </div>
    );
  }

  if (!summary.length) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-20 text-center">
        <Scale className="h-12 w-12 text-slate-400" />
        <p className="text-lg font-semibold text-slate-900">표시할 대차대조표 데이터가 없습니다.</p>
        <p className="text-sm text-slate-500">거래 데이터를 적재하거나 reporting 스크립트를 실행해 주세요.</p>
      </div>
    );
  }

  const roleOrder = ['asset', 'liability'];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Monthly Balance Sheet</p>
          <h2 className="text-3xl font-bold text-slate-900">월별 대차대조표</h2>
          <p className="text-sm text-slate-500">reporting.balance_sheet_* 뷰를 기반으로 집계했습니다.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={cn('mr-2 h-4 w-4', isFetching ? 'animate-spin' : '')} />
          새로고침
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white/95 shadow-[0_20px_50px_rgba(15,23,42,0.05)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-4">항목</th>
                {months.map((month) => (
                  <th key={month.periodStart} className="px-6 py-4">
                    <div className="font-semibold text-slate-800">{month.label}</div>
                    <div className="text-[11px] text-slate-400">{month.periodStart} ~ {month.periodEnd}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaryRows.map((row) => (
                <tr key={row.key}>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {row.label}
                  </th>
                  {months.map((month) => {
                    const monthData = summary.find((s) => s.period_start === month.periodStart);
                    const value = monthData ? monthData[row.key] : 0;
                    const tone = row.key === 'assets' ? 'text-slate-900' : value >= 0 ? 'text-emerald-600' : 'text-rose-600';
                    return (
                      <td key={`${row.key}-${month.periodStart}`} className={cn('px-6 py-4 font-mono text-base', tone)}>
                        {formatCurrency(value || 0)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {roleOrder.map((role) => {
        const roleChannels = channelsByRole[role] ?? [];
        if (!roleChannels.length) return null;
        const title = role === 'liability' ? '부채 채널' : '자산 채널';
        return (
          <div key={role} className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
            <div className="rounded-2xl border border-slate-100 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-6 py-3">채널</th>
                      {months.map((month) => (
                        <th key={month.periodStart} className="px-6 py-3">{month.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {roleChannels.map((channel) => (
                      <tr key={channel.channel}>
                        <th className="px-6 py-3 text-left text-slate-600">{channel.channel}</th>
                        {months.map((month) => {
                          const value = channel.values[month.periodStart] ?? 0;
                          const tone = role === 'liability'
                            ? value <= 0 ? 'text-slate-900' : 'text-rose-600'
                            : value >= 0 ? 'text-slate-900' : 'text-rose-600';
                          return (
                            <td key={`${channel.channel}-${month.periodStart}`} className={cn('px-6 py-3 font-mono text-sm', tone)}>
                              {formatCurrency(value)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      <p className="text-xs text-slate-400">※ 금액은 KRW 기준입니다. 카드/부채는 음수로 표시될 수 있습니다.</p>
    </div>
  );
}
