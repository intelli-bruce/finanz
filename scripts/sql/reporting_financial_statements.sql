-- Financial reporting views for Finanz
-- Usage: psql -U postgres -d postgres -f scripts/sql/reporting_financial_statements.sql

create schema if not exists reporting;

set search_path to reporting, public;

create or replace view channel_roles as
select
  c.id,
  c.name,
  c.type,
  c.bank,
  c.masked_number,
  c.metadata,
  coalesce(c.metadata ->> 'reporting_role',
           case when lower(c.name) like '%카드%' then 'liability' else 'asset' end) as reporting_role,
  coalesce(c.metadata ->> 'cash_flow_activity', 'operating') as cash_flow_activity
from public.channels c;

create or replace view asset_cash_transactions as
select
  t.*,
  cr.reporting_role,
  cr.cash_flow_activity
from public.transactions t
join channel_roles cr on cr.id = t.channel_id
where t.occurred_at is not null
  and cr.reporting_role = 'asset';

create or replace view internal_asset_transfers as
with candidates as (
  select
    t_out.id as out_id,
    t_in.id as in_id,
    t_out.channel_id as out_channel_id,
    t_in.channel_id as in_channel_id,
    t_out.amount as out_amount,
    t_in.amount as in_amount,
    abs(extract(epoch from (t_in.occurred_at - t_out.occurred_at))) as time_gap,
    row_number() over (
      partition by t_out.id
      order by abs(extract(epoch from (t_in.occurred_at - t_out.occurred_at)))
    ) as rn_out,
    row_number() over (
      partition by t_in.id
      order by abs(extract(epoch from (t_in.occurred_at - t_out.occurred_at)))
    ) as rn_in
  from asset_cash_transactions t_out
  join asset_cash_transactions t_in
    on t_out.amount < 0
   and t_in.amount > 0
   and t_out.channel_id <> t_in.channel_id
   and t_in.amount = -t_out.amount
   and abs(extract(epoch from (t_in.occurred_at - t_out.occurred_at))) <= 900 -- 15 minutes
)
select out_id, in_id
from candidates
where rn_out = 1 and rn_in = 1;

create or replace view external_asset_transactions as
select act.*
from asset_cash_transactions act
left join (
  select out_id as tx_id from internal_asset_transfers
  union all
  select in_id as tx_id from internal_asset_transfers
) paired on paired.tx_id = act.id
where paired.tx_id is null;

create or replace view calendar as
with bounds as (
  select
    min(date_trunc('day', occurred_at))::date as start_date,
    max(date_trunc('day', occurred_at))::date as end_date
  from public.transactions
)
select generate_series(start_date, end_date, interval '1 day')::date as calendar_date
from bounds
where start_date is not null;

create or replace view daily_channel_deltas as
select
  channel_id,
  date_trunc('day', occurred_at)::date as calendar_date,
  sum(amount) as delta
from public.transactions
where occurred_at is not null and channel_id is not null
group by 1,2;

create or replace view channel_daily_balances as
with calendarized as (
  select c.id as channel_id, cal.calendar_date
  from public.channels c
  cross join calendar cal
),
joined as (
  select
    calendarized.calendar_date,
    calendarized.channel_id,
    coalesce(d.delta, 0) as delta
  from calendarized
  left join daily_channel_deltas d
    on d.channel_id = calendarized.channel_id
   and d.calendar_date = calendarized.calendar_date
)
select
  calendar_date,
  channel_id,
  sum(delta) over (
    partition by channel_id
    order by calendar_date
    rows between unbounded preceding and current row
  ) as closing_balance
from joined;

create or replace view balance_sheet_monthly_channel as
with base as (
  select
    date_trunc('month', calendar_date)::date as period_start,
    (date_trunc('month', calendar_date) + interval '1 month' - interval '1 day')::date as period_end,
    channel_id,
    closing_balance,
    row_number() over (
      partition by channel_id, date_trunc('month', calendar_date)
      order by calendar_date desc
    ) as rn
  from channel_daily_balances
)
select period_start, period_end, channel_id, closing_balance
from base
where rn = 1;

create or replace view balance_sheet_quarterly_channel as
with base as (
  select
    date_trunc('quarter', calendar_date)::date as period_start,
    (date_trunc('quarter', calendar_date) + interval '3 month' - interval '1 day')::date as period_end,
    channel_id,
    closing_balance,
    row_number() over (
      partition by channel_id, date_trunc('quarter', calendar_date)
      order by calendar_date desc
    ) as rn
  from channel_daily_balances
)
select period_start, period_end, channel_id, closing_balance
from base
where rn = 1;

create or replace view balance_sheet_half_year_channel as
with base as (
  select
    (
      date_trunc('year', calendar_date)
      + case when extract(month from calendar_date) <= 6 then interval '0 month' else interval '6 month' end
    )::date as period_start,
    (
      date_trunc('year', calendar_date)
      + case when extract(month from calendar_date) <= 6 then interval '6 month' else interval '12 month' end
      - interval '1 day'
    )::date as period_end,
    channel_id,
    closing_balance,
    row_number() over (
      partition by channel_id,
      date_trunc('year', calendar_date),
      case when extract(month from calendar_date) <= 6 then 1 else 2 end
      order by calendar_date desc
    ) as rn
  from channel_daily_balances
)
select period_start, period_end, channel_id, closing_balance
from base
where rn = 1;

create or replace view balance_sheet_monthly_summary as
select
  b.period_start,
  b.period_end,
  sum(case when r.reporting_role = 'asset' then b.closing_balance else 0 end) as assets,
  sum(case when r.reporting_role = 'liability' then b.closing_balance else 0 end) as liabilities,
  sum(case when r.reporting_role = 'asset' then b.closing_balance else 0 end)
    - sum(case when r.reporting_role = 'liability' then b.closing_balance else 0 end) as equity
from balance_sheet_monthly_channel b
join channel_roles r on r.id = b.channel_id
group by 1,2
order by 1;

create or replace view balance_sheet_quarterly_summary as
select
  b.period_start,
  b.period_end,
  sum(case when r.reporting_role = 'asset' then b.closing_balance else 0 end) as assets,
  sum(case when r.reporting_role = 'liability' then b.closing_balance else 0 end) as liabilities,
  sum(case when r.reporting_role = 'asset' then b.closing_balance else 0 end)
    - sum(case when r.reporting_role = 'liability' then b.closing_balance else 0 end) as equity
from balance_sheet_quarterly_channel b
join channel_roles r on r.id = b.channel_id
group by 1,2
order by 1;

create or replace view balance_sheet_half_year_summary as
select
  b.period_start,
  b.period_end,
  sum(case when r.reporting_role = 'asset' then b.closing_balance else 0 end) as assets,
  sum(case when r.reporting_role = 'liability' then b.closing_balance else 0 end) as liabilities,
  sum(case when r.reporting_role = 'asset' then b.closing_balance else 0 end)
    - sum(case when r.reporting_role = 'liability' then b.closing_balance else 0 end) as equity
from balance_sheet_half_year_channel b
join channel_roles r on r.id = b.channel_id
group by 1,2
order by 1;

create or replace view cash_flow_monthly as
select
  date_trunc('month', t.occurred_at)::date as period_start,
  (date_trunc('month', t.occurred_at) + interval '1 month' - interval '1 day')::date as period_end,
  sum(case when t.cash_flow_activity = 'operating' then t.amount else 0 end) as operating_cash_flow,
  sum(case when t.cash_flow_activity = 'investing' then t.amount else 0 end) as investing_cash_flow,
  sum(case when t.cash_flow_activity = 'financing' then t.amount else 0 end) as financing_cash_flow,
  sum(case when t.amount > 0 then t.amount else 0 end) as total_inflows,
  sum(case when t.amount < 0 then t.amount else 0 end) as total_outflows,
  sum(t.amount) as net_cash_flow
from external_asset_transactions t
group by 1,2
order by 1;
