# Local PostgreSQL Setup
1. Start Postgres (Docker example):
   ```bash
   docker run --name finanz-postgres -e POSTGRES_PASSWORD=finanz -p 5432:5432 -d postgres:16
   ```
2. Apply schema:
   ```bash
   psql postgresql://postgres:finanz@localhost:5432/postgres -f scripts/sql/init_local_postgres.sql
   ```
3. Verify tables:
   ```bash
   psql postgresql://postgres:finanz@localhost:5432/postgres -c "\dt"
   ```
4. Update ingest scripts to insert into `transaction_files`, `channels`, `transactions`.
