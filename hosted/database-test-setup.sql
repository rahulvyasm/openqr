-- Local disposable Postgres only: emulates managed Supabase roles and schemas.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
