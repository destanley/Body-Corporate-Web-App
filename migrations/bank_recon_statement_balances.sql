-- Bank recon module: statement-level balances and line ordering.
-- Applied via the Supabase MCP on 8 August 2026.
--
-- The existing parser already captured each transaction line's running balance
-- in its regex and then threw it away. Keeping it is what makes a statement
-- verifiable: opening + credits - debits must equal closing, and every line's
-- printed balance must agree with the line above it plus its own movement.
-- Without it the import could silently drop a line and nothing would notice.

alter table bank_statement_documents
  add column if not exists opening_balance numeric,
  add column if not exists closing_balance numeric,
  add column if not exists balance_source text not null default 'derived',
  add column if not exists statement_from date,
  add column if not exists statement_to date,
  add column if not exists account_number text;

alter table bank_transactions
  add column if not exists balance_after numeric,
  add column if not exists line_no integer;

comment on column bank_statement_documents.opening_balance is
 'Balance the statement opened on. ''derived'' means it was reversed out of the first transaction line''s running balance; ''printed'' means read off the statement; ''entered'' means the trustee typed it.';
comment on column bank_transactions.balance_after is
 'Running balance printed against this line. Captured from the statement, never computed — it is what the arithmetic check is checked AGAINST.';
comment on column bank_transactions.line_no is
 'Order of the line within its statement, so the ledger can be reprinted in statement order rather than sorted by date.';
