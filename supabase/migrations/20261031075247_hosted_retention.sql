-- Managed Supabase includes pg_cron. Plain disposable Postgres tests do not.
do $migration$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('openqr-retention','17 3 * * *','select public.oq_maintenance();');
  end if;
end $migration$;
