-- Arquivo privado e reversível de registros de teste removidos na preparação da entrega.
-- Fica no schema private (não exposto pela API) e nunca vai para o GitHub.
create table if not exists private.archived_test_records (
  id bigint generated always as identity primary key,
  archived_at timestamptz not null default now(),
  source_table text not null,
  source_id uuid not null,
  reason text not null,
  row_data jsonb not null
);
alter table private.archived_test_records enable row level security;
revoke all on private.archived_test_records from anon, authenticated;
comment on table private.archived_test_records is 'Cópia privada de registros de teste excluídos; pode ser descartada após a validação final.';
