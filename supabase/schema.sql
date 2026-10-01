-- 备婚助手 数据库 Schema
-- 在 Supabase Dashboard > SQL Editor 中执行

-- 宾客表
create table guests (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  group_name text not null default '其他',
  phone text,
  notes text,
  table_id uuid,
  seat_index int,
  room_id uuid,
  stay_dates jsonb not null default '[]',
  status text not null default 'unassigned',
  created_at timestamptz default now()
);

-- 桌子表
create table tables (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  label text not null,
  x numeric not null default 200,
  y numeric not null default 200,
  seats int not null default 10,
  rotation numeric not null default 0,
  created_at timestamptz default now()
);

-- 住宿房间表（大床房 / 标间）
create table rooms (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  type text not null default '标间',
  label text not null,
  notes text,
  created_at timestamptz default now()
);

-- 项目配置表（存住宿晚次列表等全局设置，每个项目一行）
create table project_config (
  project_id text primary key,
  stay_dates jsonb not null default '[]',
  updated_at timestamptz default now()
);

-- 笔记表
create table notes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  category text not null default '其他',
  title text,
  content text,
  images jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 索引
create index idx_guests_project on guests(project_id);
create index idx_tables_project on tables(project_id);
create index idx_rooms_project on rooms(project_id);
create index idx_notes_project on notes(project_id);

-- 启用 Row Level Security（原型阶段放开所有权限）
alter table guests enable row level security;
alter table tables enable row level security;
alter table rooms enable row level security;
alter table project_config enable row level security;
alter table notes enable row level security;

create policy "allow all guests" on guests for all using (true) with check (true);
create policy "allow all tables" on tables for all using (true) with check (true);
create policy "allow all rooms" on rooms for all using (true) with check (true);
create policy "allow all project_config" on project_config for all using (true) with check (true);
create policy "allow all notes" on notes for all using (true) with check (true);

-- 启用 Realtime（关键：多人实时同步依赖此配置）
alter publication supabase_realtime add table guests;
alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table project_config;
alter publication supabase_realtime add table notes;

-- ============================================================
-- 增量迁移：为「已存在」的旧库补充住宿功能（首次建库可忽略本段）
-- 若之前已建过 guests/rooms，请执行以下语句补齐日期相关结构：
--
-- alter table guests add column if not exists room_id uuid;
-- alter table guests add column if not exists stay_dates jsonb not null default '[]';
--
-- create table if not exists rooms (
--   id uuid primary key default gen_random_uuid(),
--   project_id text not null,
--   type text not null default '标间',
--   label text not null,
--   notes text,
--   created_at timestamptz default now()
-- );
-- create index if not exists idx_rooms_project on rooms(project_id);
-- alter table rooms enable row level security;
-- create policy "allow all rooms" on rooms for all using (true) with check (true);
-- alter publication supabase_realtime add table rooms;
--
-- create table if not exists project_config (
--   project_id text primary key,
--   stay_dates jsonb not null default '[]',
--   updated_at timestamptz default now()
-- );
-- alter table project_config enable row level security;
-- create policy "allow all project_config" on project_config for all using (true) with check (true);
-- alter publication supabase_realtime add table project_config;
-- ============================================================
