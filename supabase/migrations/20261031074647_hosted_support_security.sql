-- Event-trigger helpers are not a client API.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
  end if;
end $$;

create function public.oq_case_update(p_event bigint,p_actor uuid,p_patch jsonb) returns void
language plpgsql security invoker set search_path='' as $$ begin
  if not exists(select 1 from public.oq_staff where user_id=p_actor and role in ('super_admin','support','billing')) then raise exception 'Case access denied.'; end if;
  update public.oq_events set data=data || (p_patch-'assign') || jsonb_build_object('updatedAt',now()) where id=p_event and data->>'support'='true';
  if not found then raise exception 'Case not found.'; end if;
end $$;
revoke all on function public.oq_case_update(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.oq_case_update(bigint,uuid,jsonb) to service_role;
