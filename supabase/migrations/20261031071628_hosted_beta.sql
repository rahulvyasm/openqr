-- Hosted beta: private server-owned state. Browsers never receive the secret key.
create schema openqr_private;
revoke all on schema openqr_private from public, anon, authenticated;
grant usage on schema openqr_private to service_role;
create function openqr_private.verified_email(p_actor uuid) returns text
language sql security definer set search_path='' as $$
  select lower(email) from auth.users where id=p_actor and email_confirmed_at is not null
$$;
create function openqr_private.live_session(p_actor uuid,p_session uuid) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from auth.sessions where id=p_session and user_id=p_actor)
$$;
create function openqr_private.session_count() returns bigint
language sql security definer set search_path='' as $$ select count(*) from auth.sessions $$;
revoke all on function openqr_private.verified_email(uuid),openqr_private.live_session(uuid,uuid) from public,anon,authenticated;
grant execute on function openqr_private.verified_email(uuid),openqr_private.live_session(uuid,uuid) to service_role;
revoke all on function openqr_private.session_count() from public,anon,authenticated;
grant execute on function openqr_private.session_count() to service_role;
create table public.oq_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.oq_staff (
  user_id uuid primary key references public.oq_accounts(id) on delete cascade,
  role text not null check (role in ('super_admin','billing','support','operations','analyst'))
);
create table public.oq_grants (
  user_id uuid primary key references public.oq_accounts(id) on delete cascade,
  tier text not null check (tier in ('free','plus','pro','unlimited')),
  updated_at timestamptz not null default now()
);
create table public.oq_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.oq_accounts(id),
  name text not null check (length(name) between 1 and 80),
  document jsonb not null default '{"codes":[],"assets":[],"folders":[],"templates":[],"pageTemplates":[],"drafts":{},"versions":{},"audit":[],"service":{}}',
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);
create index oq_workspaces_owner on public.oq_workspaces(owner_id);
create table public.oq_members (
  workspace_id uuid not null references public.oq_workspaces(id) on delete cascade,
  user_id uuid not null references public.oq_accounts(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create index oq_members_user on public.oq_members(user_id);
create table public.oq_published (
  slug text primary key,
  id uuid not null unique,
  workspace_id uuid not null references public.oq_workspaces(id) on delete cascade,
  code jsonb not null
);
create index oq_published_workspace on public.oq_published(workspace_id);
create table public.oq_scan_totals (
  code_id uuid primary key,
  workspace_id uuid not null references public.oq_workspaces(id) on delete cascade,
  scans bigint not null default 0
);
create index oq_scan_totals_workspace on public.oq_scan_totals(workspace_id);
create table public.oq_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.oq_workspaces(id) on delete cascade,
  code_id uuid not null,
  kind text not null check (kind in ('scan','tap','submission')),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index oq_events_workspace_time on public.oq_events(workspace_id,created_at);
create index oq_events_code_time on public.oq_events(code_id,created_at);
create table public.oq_staff_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.oq_accounts(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create table public.oq_rate_limits (
  key text primary key,
  hits integer not null,
  expires_at timestamptz not null
);
create table public.oq_launch_config (
  key text primary key, value text not null
);
insert into public.oq_launch_config values ('bootstrap_admin_email','');

-- These are server APIs, not exposed browser tables. RLS denies anon/authenticated access.
do $$ declare t text; begin
  foreach t in array array['oq_accounts','oq_staff','oq_grants','oq_workspaces','oq_members','oq_published','oq_scan_totals','oq_events','oq_staff_audit','oq_rate_limits','oq_launch_config'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage, select on sequence public.oq_events_id_seq, public.oq_staff_audit_id_seq to service_role;

create function public.oq_bootstrap(p_actor uuid, p_name text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_email text; v_id uuid; begin
  -- A database lock serializes concurrent initial logins for the same identity.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
  select openqr_private.verified_email(p_actor) into v_email;
  if v_email is null then raise exception 'Verify your email address first.'; end if;
  insert into public.oq_accounts(id,name) values(p_actor,left(coalesce(nullif(trim(p_name),''),'OpenQR member'),80))
    on conflict (id) do nothing;
  if v_email=(select value from public.oq_launch_config where key='bootstrap_admin_email') then
    -- A one-time grant, never repeated after a subsequent administrator revokes it.
    if not exists(select 1 from public.oq_launch_config where key='bootstrap_admin_claimed') then
      insert into public.oq_staff values(p_actor,'super_admin');
      insert into public.oq_grants values(p_actor,'unlimited',now());
      insert into public.oq_launch_config values('bootstrap_admin_claimed',p_actor::text);
      insert into public.oq_staff_audit(actor_id,action,target_type,target_id,reason)
        values(p_actor,'account.bootstrap_admin','account',p_actor::text,'Verified service-owner email');
    end if;
  end if;
  select id into v_id from public.oq_workspaces where owner_id=p_actor order by created_at limit 1;
  if v_id is null then
    insert into public.oq_workspaces(owner_id,name) values(p_actor,left(p_name||'''s workspace',80)) returning id into v_id;
    insert into public.oq_members values(v_id,p_actor,'owner',now());
  end if;
  return v_id;
end $$;

create function public.oq_commit(p_actor uuid,p_workspace uuid,p_revision bigint,p_document jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare w public.oq_workspaces; tier text; cap integer; old_n integer; new_n integer;
 old_dynamic integer; new_dynamic integer; old_pages integer; new_pages integer;
 old_bytes bigint; new_bytes bigint; c jsonb;
begin
  select * into w from public.oq_workspaces where id=p_workspace for update;
  if not found then raise exception 'Workspace not found.'; end if;
  if not exists(select 1 from public.oq_members where workspace_id=w.id and user_id=p_actor and role in ('owner','admin','editor'))
    or exists(select 1 from public.oq_accounts where id=p_actor and suspended) then
    raise exception 'Workspace edit permission required.';
  end if;
  if w.revision<>p_revision then raise exception 'revision_conflict'; end if;
  if octet_length(p_document::text)>8388608 then raise exception 'Workspace is too large for this beta.'; end if;
  if jsonb_typeof(p_document->'codes') <> 'array' or jsonb_typeof(p_document->'assets') <> 'array' then
    raise exception 'Invalid workspace document.';
  end if;
  select coalesce((select g.tier from public.oq_grants g where user_id=w.owner_id),'free') into tier;
  cap:=case tier when 'free' then 25 when 'plus' then 1000 when 'pro' then 10000 else null end;
  new_n:=jsonb_array_length(p_document->'codes'); old_n:=jsonb_array_length(w.document->'codes');
  if cap is not null and new_n>cap and new_n>old_n then raise exception 'plan_limit: QR code allowance reached.'; end if;
  if tier='free' then
    select count(*) into old_dynamic from jsonb_array_elements(w.document->'codes') x where (x->>'dynamic')::boolean;
    select count(*) into new_dynamic from jsonb_array_elements(p_document->'codes') x where (x->>'dynamic')::boolean;
    if new_dynamic>3 and new_dynamic>old_dynamic then raise exception 'plan_limit: Free includes three dynamic codes.'; end if;
    select count(*) into old_pages from jsonb_array_elements(w.document->'codes') x where x->>'type'='experience';
    select count(*) into new_pages from jsonb_array_elements(p_document->'codes') x where x->>'type'='experience';
    if new_pages>1 and new_pages>old_pages then raise exception 'plan_limit: Free includes one experience.'; end if;
  end if;
  select coalesce(sum((x->>'size')::bigint),0) into new_bytes from jsonb_array_elements(p_document->'assets') x;
  select coalesce(sum((x->>'size')::bigint),0) into old_bytes from jsonb_array_elements(w.document->'assets') x;
  if tier='free' and new_bytes>10485760 and new_bytes>old_bytes then raise exception 'plan_limit: Free storage allowance reached.'; end if;
  -- A separate, bounded public index makes visitor reads independent of private workspace state.
  delete from public.oq_published where workspace_id=w.id;
  for c in select * from jsonb_array_elements(p_document->'codes') loop
    if (c->>'dynamic')::boolean then
      insert into public.oq_published(slug,id,workspace_id,code) values(c->>'slug',(c->>'id')::uuid,w.id,c);
    end if;
  end loop;
  update public.oq_workspaces set document=p_document, revision=revision+1 where id=w.id;
  return w.revision+1;
end $$;

create function public.oq_rate(p_key text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; begin
  insert into public.oq_rate_limits(key,hits,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set
    hits=case when public.oq_rate_limits.expires_at<=now() then 1 else public.oq_rate_limits.hits+1 end,
    expires_at=case when public.oq_rate_limits.expires_at<=now() then now()+make_interval(secs=>p_seconds) else public.oq_rate_limits.expires_at end
  returning hits into n;
  return n<=p_limit;
end $$;

create function public.oq_grant(p_actor uuid,p_target uuid,p_tier text,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$ begin
  if not exists(select 1 from public.oq_staff s join public.oq_accounts a on a.id=s.user_id
      where s.user_id=p_actor and s.role='super_admin' and not a.suspended) then
    raise exception 'Super Admin access required.';
  end if;
  if p_tier not in ('free','plus','pro','unlimited','inherit') or length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Choose a plan and give a reason.';
  end if;
  if p_tier='inherit' then delete from public.oq_grants where user_id=p_target;
  else insert into public.oq_grants values(p_target,p_tier,now())
    on conflict(user_id) do update set tier=excluded.tier,updated_at=excluded.updated_at;
  end if;
  insert into public.oq_staff_audit(actor_id,action,target_type,target_id,reason)
    values(p_actor,'account.access_'||p_tier,'account',p_target::text,p_reason);
end $$;

create function public.oq_live_session(p_actor uuid,p_session uuid) returns boolean
language sql security invoker set search_path='' as $$
  select openqr_private.live_session(p_actor,p_session)
$$;

revoke all on function public.oq_bootstrap(uuid,text), public.oq_commit(uuid,uuid,bigint,jsonb),
 public.oq_rate(text,integer,integer), public.oq_grant(uuid,uuid,text,text),public.oq_live_session(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.oq_bootstrap(uuid,text), public.oq_commit(uuid,uuid,bigint,jsonb),
 public.oq_rate(text,integer,integer), public.oq_grant(uuid,uuid,text,text),public.oq_live_session(uuid,uuid) to service_role;

create function public.oq_public_visit(p_slug text,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare row public.oq_published; total bigint; cap bigint; begin
  select * into row from public.oq_published where slug=p_slug for update;
  if not found then raise exception 'public_unavailable: QR code not found.'; end if;
  if (row.code->>'active')::boolean is not true then raise exception 'public_unavailable: This code is paused.'; end if;
  cap:=(row.code->'campaign'->>'scanLimit')::bigint;
  if cap is not null then
    select coalesce((select scans from public.oq_scan_totals where code_id=row.id),0) into total;
    if total>=cap then raise exception 'public_unavailable: This code has reached its scan limit.'; end if;
  end if;
  if nullif(row.code->'campaign'->>'startsAt','')::timestamptz>now() then raise exception 'public_unavailable: This campaign has not started.'; end if;
  if nullif(row.code->'campaign'->>'expiresAt','')::timestamptz<=now() then raise exception 'public_unavailable: This campaign has ended.'; end if;
  insert into public.oq_events(workspace_id,code_id,kind,data) values(row.workspace_id,row.id,'scan',p_data);
  insert into public.oq_scan_totals values(row.id,row.workspace_id,1)
    on conflict(code_id) do update set scans=public.oq_scan_totals.scans+1;
end $$;
revoke all on function public.oq_public_visit(text,jsonb) from public,anon,authenticated;
grant execute on function public.oq_public_visit(text,jsonb) to service_role;

create function public.oq_session_count() returns bigint
language sql security invoker set search_path='' as $$ select openqr_private.session_count() $$;
create function public.oq_create_workspace(p_actor uuid,p_name text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare tier text; total integer; v_id uuid; begin
  perform 1 from public.oq_accounts where id=p_actor and not suspended for update;
  if not found then raise exception 'Account not found.'; end if;
  select g.tier into tier from public.oq_grants g where user_id=p_actor;
  select count(*) into total from public.oq_workspaces where owner_id=p_actor;
  if coalesce(tier,'free')<>'unlimited' and total>=3 then raise exception 'plan_limit: Workspace allowance reached.'; end if;
  insert into public.oq_workspaces(owner_id,name) values(p_actor,p_name) returning id into v_id;
  insert into public.oq_members values(v_id,p_actor,'owner',now());
  return v_id;
end $$;
revoke all on function public.oq_session_count(),public.oq_create_workspace(uuid,text) from public,anon,authenticated;
grant execute on function public.oq_session_count(),public.oq_create_workspace(uuid,text) to service_role;

create function public.oq_case_note(p_event bigint,p_actor uuid,p_body text,p_visibility text) returns void
language plpgsql security invoker set search_path='' as $$
declare e public.oq_events; staff_role text; begin
  select * into e from public.oq_events where id=p_event for update;
  if not found or e.data->>'support'<>'true' then raise exception 'Case not found.'; end if;
  select role into staff_role from public.oq_staff where user_id=p_actor;
  if staff_role not in ('super_admin','support','billing') or staff_role is null then
    if p_visibility<>'public' or not exists(select 1 from public.oq_members where workspace_id=e.workspace_id and user_id=p_actor) then
      raise exception 'Case access denied.';
    end if;
  end if;
  if length(trim(p_body)) not between 1 and 5000 or p_visibility not in ('public','internal') then raise exception 'Invalid note.'; end if;
  update public.oq_events set data=jsonb_set(data,'{notes}',coalesce(data->'notes','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'body',p_body,'visibility',p_visibility,'at',now(),'authorId',p_actor,'author',(select name from public.oq_accounts where id=p_actor)))) where id=p_event;
end $$;
create function public.oq_submit(p_workspace uuid,p_code uuid,p_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_code::text,0));
  if exists(select 1 from public.oq_events where code_id=p_code and kind='submission' and created_at>now()-interval '60 seconds' and data->>'blockId'=p_data->>'blockId' and data->'answers'=p_data->'answers') then return; end if;
  if (select count(*) from public.oq_events where code_id=p_code and kind='submission')>=10000 then raise exception 'public_unavailable: This form cannot accept more responses right now.'; end if;
  insert into public.oq_events(workspace_id,code_id,kind,data) values(p_workspace,p_code,'submission',p_data);
end $$;
create function public.oq_maintenance() returns void
language plpgsql security invoker set search_path='' as $$ begin
  delete from public.oq_rate_limits where expires_at<now()-interval '1 day';
  delete from public.oq_events where created_at<now()-interval '365 days' or (kind<>'submission' and created_at<now()-interval '30 days');
end $$;
revoke all on function public.oq_case_note(bigint,uuid,text,text), public.oq_submit(uuid,uuid,jsonb),public.oq_maintenance() from public,anon,authenticated;
grant execute on function public.oq_case_note(bigint,uuid,text,text), public.oq_submit(uuid,uuid,jsonb),public.oq_maintenance() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('openqr-media','openqr-media',false,20971520,array['image/png','image/jpeg','application/pdf','audio/mpeg','video/mp4','video/webm'])
on conflict(id) do nothing;
