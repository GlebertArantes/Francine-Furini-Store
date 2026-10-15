create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'PASS: %', p_name;
end $$;

-- Executa p_sql como (role, uid) e devolve a mensagem de erro, ou null se passou.
-- p_role: 'anon' | 'authenticated' | 'service_role'
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    reset role;
    return null;
  exception when others then
    reset role;
    return sqlerrm;
  end;
end $$;
