import { Fragment, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  getMonthlyBalanceSheet,
  getMonthlyIncomeSources,
  getCardInstallments,
  type BalanceSheetMonthlySummaryRow,
  type IncomeSourceMonthlyRow,
  type CardInstallmentPlanRow,
} from '@/api/client';

const currencyFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('ko-KR');

type SummaryRowKey = keyof Pick<BalanceSheetMonthlySummaryRow, 'assets' | 'liabilities' | 'equity'>;

type ChannelByRole = Record<
  string,
  Array<{
    channel: string;
    values: Record<string, number>;
  }>
>;

const formatCurrency = (value: number) => currencyFormatter.format(Math.round(value));

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  marginTop: '8px',
};

const headerCellStyle: CSSProperties = {
  border: '1px solid #d4d4d8',
  padding: '8px',
  textAlign: 'left',
  backgroundColor: '#f8fafc',
  fontWeight: 600,
};

const cellStyle: CSSProperties = {
  border: '1px solid #e4e4e7',
  padding: '6px 8px',
  textAlign: 'right',
};

const rowHeaderCellStyle: CSSProperties = {
  ...cellStyle,
  textAlign: 'left',
  fontWeight: 600,
};

export function BalanceSheetView() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['reports', 'balance-sheet', 'monthly'],
    queryFn: getMonthlyBalanceSheet,
  });
  const { data: incomeSourcesData = [], isLoading: isIncomeSourcesLoading } = useQuery({
    queryKey: ['reports', 'income-sources', 'monthly'],
    queryFn: getMonthlyIncomeSources,
  });
  const { data: installmentPlans = [], isLoading: isInstallmentLoading } = useQuery({
    queryKey: ['reports', 'card-installments'],
    queryFn: getCardInstallments,
  });

  const summary = useMemo(() => data?.summary ?? [], [data?.summary]);
  const months = useMemo(() => {
    return [...summary]
      .map((row) => ({
        periodStart: row.period_start,
        periodEnd: row.period_end,
        label: monthFormatter.format(new Date(`${row.period_start}T00:00:00Z`)),
      }))
      .sort((a, b) => (a.periodStart > b.periodStart ? 1 : -1));
  }, [summary]);

  const [selectedPeriodOverride, setSelectedPeriodOverride] = useState<string | null>(null);
  const selectedPeriodStart = selectedPeriodOverride ?? months.at(-1)?.periodStart ?? null;
  const currentPeriod = months.find((month) => month.periodStart === selectedPeriodStart) ?? months.at(-1) ?? null;
  const currentIndex = currentPeriod ? months.findIndex((month) => month.periodStart === currentPeriod.periodStart) : -1;
  const previousPeriod = currentIndex > 0 ? months[currentIndex - 1] : null;

  const summaryByPeriod = useMemo(() => {
    const map = new Map<string, BalanceSheetMonthlySummaryRow>();
    summary.forEach((row) => {
      map.set(row.period_start, row);
    });
    return map;
  }, [summary]);

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

    const referencePeriodStart = selectedPeriodStart ?? months.at(-1)?.periodStart ?? null;
    keys.forEach((role) => {
      grouped[role] = grouped[role]
        .map((item) => ({
          channel: item.channel,
          values: item.values,
        }))
        .sort((a, b) => {
          const sortPeriod = referencePeriodStart;
          const aValue = sortPeriod ? Math.abs(a.values[sortPeriod] ?? 0) : 0;
          const bValue = sortPeriod ? Math.abs(b.values[sortPeriod] ?? 0) : 0;
          return bValue - aValue;
        });
    });

    return grouped;
  }, [data?.channels, months, selectedPeriodStart]);

  const formatValueForPeriod = (value: number | undefined, period: { periodStart: string } | null) => {
    if (!period) return '-';
    if (value === undefined || value === null) return '-';
    return formatCurrency(value);
  };

  const getSummaryValue = (period: { periodStart: string } | null, key: SummaryRowKey) => {
    if (!period) return undefined;
    const row = summaryByPeriod.get(period.periodStart);
    return row ? row[key] : undefined;
  };

  type Section = {
    id: 'asset' | 'liability' | 'equity';
    label: string;
    rows: Array<{ id: string; label: string; current?: number; previous?: number }>;
    totals: { current?: number; previous?: number };
  };

  const sections: Section[] = [
    {
      id: 'asset',
      label: '자산',
      rows: (channelsByRole.asset ?? []).map((channel) => ({
        id: channel.channel,
        label: channel.channel,
        current: currentPeriod ? channel.values[currentPeriod.periodStart] : undefined,
        previous: previousPeriod ? channel.values[previousPeriod.periodStart] : undefined,
      })),
      totals: {
        current: getSummaryValue(currentPeriod, 'assets'),
        previous: getSummaryValue(previousPeriod, 'assets'),
      },
    },
    {
      id: 'liability',
      label: '부채',
      rows: (channelsByRole.liability ?? []).map((channel) => ({
        id: channel.channel,
        label: channel.channel,
        current: currentPeriod ? channel.values[currentPeriod.periodStart] : undefined,
        previous: previousPeriod ? channel.values[previousPeriod.periodStart] : undefined,
      })),
      totals: {
        current: getSummaryValue(currentPeriod, 'liabilities'),
        previous: getSummaryValue(previousPeriod, 'liabilities'),
      },
    },
    {
      id: 'equity',
      label: '자본',
      rows: [],
      totals: {
        current: getSummaryValue(currentPeriod, 'equity'),
        previous: getSummaryValue(previousPeriod, 'equity'),
      },
    },
  ];

  const sortedInstallments = useMemo<CardInstallmentPlanRow[]>(() => {
    return [...installmentPlans].sort((a, b) => {
      const remainingDiff = b.remaining_principal - a.remaining_principal;
      if (remainingDiff !== 0) return remainingDiff;
      return (b.remaining_months || 0) - (a.remaining_months || 0);
    });
  }, [installmentPlans]);

  if (isLoading) {
    return <p>대차대조표 데이터를 불러오는 중입니다...</p>;
  }

  if (isError) {
    return (
      <div>
        <p>대차대조표 데이터를 불러오지 못했습니다.</p>
        <p>Postgres reporting 뷰 적용 여부와 API 로그를 확인해 주세요.</p>
        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          다시 시도
        </button>
      </div>
    );
  }

  if (!summary.length) {
    return (
      <div>
        <p>표시할 대차대조표 데이터가 없습니다.</p>
        <p>거래 데이터를 적재하거나 reporting 스크립트를 실행해 주세요.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>월별 대차대조표</h2>
      <p>reporting.balance_sheet_* 뷰를 기반으로 집계했습니다.</p>
      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        새로고침
      </button>

      <section>
        <div style={{ margin: '12px 0' }}>
          <label htmlFor="balance-sheet-period" style={{ marginRight: '8px' }}>
            기준 기간
          </label>
          <select
            id="balance-sheet-period"
            value={selectedPeriodStart ?? ''}
            onChange={(event) => setSelectedPeriodOverride(event.target.value)}
            disabled={!months.length}
          >
            {months.map((month) => (
              <option key={month.periodStart} value={month.periodStart}>
                {month.label} ({month.periodStart} ~ {month.periodEnd})
              </option>
            ))}
          </select>
          {previousPeriod ? (
            <span style={{ marginLeft: '8px' }}>
              비교 기간: {previousPeriod.label} ({previousPeriod.periodStart} ~ {previousPeriod.periodEnd})
            </span>
          ) : (
            <span style={{ marginLeft: '8px' }}>비교할 이전 기간이 없습니다.</span>
          )}
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headerCellStyle}>구분</th>
              <th style={headerCellStyle}>계정</th>
              <th style={headerCellStyle}>{currentPeriod ? currentPeriod.label : '선택 기간'}</th>
              <th style={headerCellStyle}>{previousPeriod ? previousPeriod.label : '비교 기간'}</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              if (!section.rows.length) {
                return (
                  <tr key={`${section.id}-only-total`}>
                    <td style={rowHeaderCellStyle}>{section.label}</td>
                    <td style={rowHeaderCellStyle}>{section.label} 합계</td>
                    <td style={cellStyle}>{formatValueForPeriod(section.totals.current, currentPeriod)}</td>
                    <td style={cellStyle}>{formatValueForPeriod(section.totals.previous, previousPeriod)}</td>
                  </tr>
                );
              }

              const rowSpan = section.rows.length + 1;
              return (
                <Fragment key={section.id}>
                  {section.rows.map((row, index) => (
                    <tr key={`${section.id}-${row.id}`}>
                      {index === 0 && (
                        <td style={rowHeaderCellStyle} rowSpan={rowSpan}>
                          {section.label}
                        </td>
                      )}
                      <td style={rowHeaderCellStyle}>{row.label}</td>
                      <td style={cellStyle}>{formatValueForPeriod(row.current, currentPeriod)}</td>
                      <td style={cellStyle}>{formatValueForPeriod(row.previous, previousPeriod)}</td>
                    </tr>
                  ))}
                  <tr key={`${section.id}-total`}>
                    <td style={rowHeaderCellStyle}>{section.label} 합계</td>
                    <td style={cellStyle}>{formatValueForPeriod(section.totals.current, currentPeriod)}</td>
                    <td style={cellStyle}>{formatValueForPeriod(section.totals.previous, previousPeriod)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3>수입원별 집계</h3>
        {isIncomeSourcesLoading ? (
          <p>수입원 데이터를 불러오는 중입니다...</p>
        ) : (
          (() => {
            const byPeriod = new Map<string, IncomeSourceMonthlyRow[]>();
            incomeSourcesData.forEach((row) => {
              const list = byPeriod.get(row.period_start) ?? [];
              list.push(row);
              byPeriod.set(row.period_start, list);
            });
            const currentRows = currentPeriod ? byPeriod.get(currentPeriod.periodStart) ?? [] : [];
            const previousRows = previousPeriod ? byPeriod.get(previousPeriod.periodStart) ?? [] : [];
            const allSources = new Set<string>([
              ...currentRows.map((row) => row.source_name),
              ...previousRows.map((row) => row.source_name)
            ]);
            if (!allSources.size) {
              return <p>선택한 기간에 매칭된 수입원이 없습니다.</p>;
            }
            return (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={headerCellStyle}>수입원</th>
                    <th style={headerCellStyle}>{currentPeriod ? currentPeriod.label : '선택 기간'}</th>
                    <th style={headerCellStyle}>{previousPeriod ? previousPeriod.label : '비교 기간'}</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(allSources)
                    .sort()
                    .map((source) => {
                      const currentRow = currentRows.find((row) => row.source_name === source);
                      const previousRow = previousRows.find((row) => row.source_name === source);
                      return (
                        <tr key={source}>
                          <td style={rowHeaderCellStyle}>{source}</td>
                          <td style={cellStyle}>
                            {currentRow ? (
                              <>
                                {formatCurrency(currentRow.total_amount)}
                                <span style={{ marginLeft: '4px', fontSize: '12px', color: '#475569' }}>
                                  ({currentRow.transaction_count}건)
                                </span>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td style={cellStyle}>
                            {previousRow ? (
                              <>
                                {formatCurrency(previousRow.total_amount)}
                                <span style={{ marginLeft: '4px', fontSize: '12px', color: '#475569' }}>
                                  ({previousRow.transaction_count}건)
                                </span>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            );
          })()
        )}
      </section>

      <section>
        <h3>카드 할부 현황</h3>
        {isInstallmentLoading ? (
          <p>카드 할부 데이터를 불러오는 중입니다...</p>
        ) : sortedInstallments.length ? (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>카드</th>
                <th style={headerCellStyle}>거래</th>
                <th style={headerCellStyle}>총 금액</th>
                <th style={headerCellStyle}>할부 개월</th>
                <th style={headerCellStyle}>월 납입</th>
                <th style={headerCellStyle}>잔여 개월</th>
                <th style={headerCellStyle}>잔여 원금</th>
                <th style={headerCellStyle}>구매일</th>
                <th style={headerCellStyle}>종료 예정</th>
              </tr>
            </thead>
            <tbody>
              {sortedInstallments.map((plan) => (
                <tr key={plan.transaction_id}>
                  <td style={rowHeaderCellStyle}>{plan.channel_name}</td>
                  <td style={rowHeaderCellStyle}>{plan.description || '-'}</td>
                  <td style={cellStyle}>{formatCurrency(plan.total_amount)}</td>
                  <td style={cellStyle}>{plan.installment_months}개월</td>
                  <td style={cellStyle}>{formatCurrency(plan.monthly_amount)}</td>
                  <td style={cellStyle}>{plan.remaining_months}개월</td>
                  <td style={cellStyle}>{formatCurrency(plan.remaining_principal)}</td>
                  <td style={cellStyle}>{plan.purchase_date ? dateFormatter.format(new Date(plan.purchase_date)) : '-'}</td>
                  <td style={cellStyle}>{plan.projected_end_date ? dateFormatter.format(new Date(plan.projected_end_date)) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>현재 할부로 진행 중인 카드 거래가 없습니다.</p>
        )}
      </section>

      <p>※ 금액은 KRW 기준입니다. 카드/부채는 음수로 표시될 수 있습니다.</p>
    </div>
  );
}
