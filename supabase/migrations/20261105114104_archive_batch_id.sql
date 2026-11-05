-- Identificação de lote no arquivo privado (recuperação por lote). Aditiva: não toca dados operacionais.
alter table private.archived_test_records add column if not exists batch_id text;
update private.archived_test_records set batch_id = '2026-11-04-pedidos-de-teste' where batch_id is null;
alter table private.archived_test_records alter column batch_id set not null;
create index if not exists archived_test_records_batch_idx on private.archived_test_records (batch_id, source_table);
comment on column private.archived_test_records.batch_id is 'Lote de arquivamento (data + descrição). Tabela de origem em source_table; justificativa em reason; linha completa em row_data.';
