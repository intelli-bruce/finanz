-- Normalize transaction amount signs for sources that encode [+]/[-] in the type field

update public.transactions
   set amount = -abs(amount)
 where amount > 0
   and (
     transaction_type like '[-%'
     or raw ->> '거래구분' like '[-%'
     or raw ->> '거래 구분' like '[-%'
     or raw ->> '구분' like '[-%'
   );

update public.transactions
   set amount = abs(amount)
 where amount < 0
   and (
     transaction_type like '[+%'
     or raw ->> '거래구분' like '[+%'
     or raw ->> '거래 구분' like '[+%'
     or raw ->> '구분' like '[+%'
   );

vacuum analyze public.transactions;
