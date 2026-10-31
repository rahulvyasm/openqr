begin;
update public.oq_launch_config set value='owner@example.com' where key='bootstrap_admin_email';
insert into auth.users values
 ('10000000-0000-4000-8000-000000000001','owner@example.com',now()),
 ('10000000-0000-4000-8000-000000000002','regular@example.com',now()),
 ('10000000-0000-4000-8000-000000000003','unverified@example.com',null);
set local role service_role;
do $$ declare admin_id uuid:='10000000-0000-4000-8000-000000000001'; actor uuid:='10000000-0000-4000-8000-000000000002'; w uuid; doc jsonb; c jsonb; rev bigint; begin
  perform public.oq_bootstrap(admin_id,'Rahul');
  assert (select role='super_admin' from public.oq_staff where user_id=admin_id),'owner bootstrap';
  assert (select tier='unlimited' from public.oq_grants where user_id=admin_id),'owner unlimited';
  w:=public.oq_bootstrap(actor,'Regular');
  assert not exists(select 1 from public.oq_staff where user_id=actor),'signup cannot grant staff';
  begin perform public.oq_bootstrap('10000000-0000-4000-8000-000000000003','No'); raise exception 'unverified signup accepted';
    exception when raise_exception then if sqlerrm='unverified signup accepted' then raise; end if; end;
  select document into doc from public.oq_workspaces where id=w;
  c:=jsonb_build_object('id',gen_random_uuid(),'slug','local-test-code','dynamic',true,'active',true,'type','url','data',jsonb_build_object('url','https://example.com'),'campaign',jsonb_build_object('scanLimit',1));
  doc:=jsonb_set(doc,'{codes}',jsonb_build_array(c));
  rev:=public.oq_commit(actor,w,0,doc); assert rev=1,'revision increments';
  begin perform public.oq_commit(actor,w,0,doc);raise exception 'stale revision accepted';
    exception when raise_exception then if sqlerrm<>'revision_conflict' then raise; end if;end;
  begin perform public.oq_commit(admin_id,w,1,doc);raise exception 'non-member write accepted';
    exception when raise_exception then if sqlerrm='non-member write accepted' then raise;end if;end;
  perform public.oq_public_visit('local-test-code','{}');
  begin perform public.oq_public_visit('local-test-code','{}');raise exception 'scan limit bypass';
    exception when raise_exception then if sqlerrm='scan limit bypass' then raise;end if;end;
  assert public.oq_rate('test-rate',1,60),'first request';assert not public.oq_rate('test-rate',1,60),'rate rejects excess';
  begin perform public.oq_grant(actor,actor,'unlimited','Trying to bypass');raise exception 'self promotion';
    exception when raise_exception then if sqlerrm='self promotion' then raise;end if;end;
  perform public.oq_grant(admin_id,actor,'plus','Early access grant');
  assert (select tier='plus' from public.oq_grants where user_id=actor),'manual grant';
  perform public.oq_grant(admin_id,actor,'inherit','Restore free limits');
  assert not exists(select 1 from public.oq_grants where user_id=actor),'grant revoked';
  assert (select count(*)>=3 from public.oq_staff_audit),'grant audit';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.oq_workspaces;raise exception 'anonymous data read allowed';exception when insufficient_privilege then null;end;
  begin perform public.oq_grant('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','unlimited','External caller');raise exception 'anonymous grant allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
