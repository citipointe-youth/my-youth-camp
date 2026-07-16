-- 0001: Consolidated baseline schema for the Youth Camp Platform.
--
-- Reproduces the exact end-state of the original migrations 001–023 (archived
-- verbatim in supabase/migrations_archive/), MINUS the deprecated settings columns
-- tent_price/classroom_price (dropped in 0004), and reflecting the field-encryption
-- end-state: people.*_enc columns present; the four legacy plaintext columns dropped
-- by the old 023 are absent.
--
-- DESIGN NOTES (carried from 001):
--  * IDs are TEXT, generated in-app (utils/id.ts: "<prefix>_<hex>"), NOT db uuids.
--  * Relational child tables for queried/aggregated data; JSONB for fixed-shape blobs.
--  * Unified `people` table: registrants + campers, distinguished by `lifecycle`.
--  * The Express API connects as the postgres superuser (DATABASE_URL), bypassing RLS.
--    RLS is enabled in 0002 as defence-in-depth against a leaked anon key.
--  * Several sensitive people/notes columns hold AES-256-GCM ciphertext at runtime
--    (field-encryption design); they are ordinary text/jsonb at the DDL level.

create table users (
  id text primary key,
  first_name text not null,
  last_name text not null,
  username text unique not null,   -- login identifier (a username, not an email)
  mobile text,
  role text not null,              -- church | zoneLeader | director | admin | firstAid
  church_id text,
  church_name text,
  zone text,
  status text not null default 'active',
  password_hash text,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table churches (
  id text primary key,
  name text not null,
  zone text not null,
  contact_phone text,
  contacts jsonb not null default '{}'::jsonb,
  accommodation_override text
    check (accommodation_override in ('tent', 'classroom') or accommodation_override is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table people (
  id text primary key,
  first_name text not null,
  last_name text not null,
  gender text not null,               -- male | female | other
  date_of_birth date,
  grade int,
  school text,
  kind text not null default 'youth', -- youth | leader
  church_id text references churches(id) on delete set null,
  church_name text not null,
  zone text not null,
  group_id text,
  mobile text,
  email text,
  suburb text,
  postcode text,
  state text,
  other_medications text,             -- encrypted in place
  parent_guardian_name text,          -- encrypted in place
  parent_phone text,                  -- encrypted in place
  parent_relation text,               -- encrypted in place
  blue_card_number text,              -- encrypted in place
  payment_status text not null default 'unpaid',
  accommodation_kind text,
  accommodation_label text,
  lifecycle text not null default 'registered',
  at_camp boolean not null default false,
  medicare_number text,               -- encrypted in place
  church_unlisted_note text,
  elvanto_meta jsonb,
  registration_type text,
  registration_cost numeric,
  discount_code text,
  ticket_number text,
  invoice_number text,
  accommodation_kind_confidence text
    check (accommodation_kind_confidence in ('guessed', 'confirmed') or accommodation_kind_confidence is null),
  discount_amount numeric,
  amount_paid numeric,
  fees_amount numeric,
  tax_amount numeric,
  needs_review boolean not null default false,
  needs_review_reason text,
  medical_conditions_enc text,        -- AES-GCM ciphertext (was text[])
  dietary_requirements_enc text,      -- AES-GCM ciphertext (was text[])
  consents_enc text,                  -- AES-GCM ciphertext (was jsonb)
  blue_card_expiry_enc text,          -- AES-GCM ciphertext (was date)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_church_idx on people(church_id);
create index people_zone_idx on people(zone);
create index people_lifecycle_idx on people(lifecycle);

create table check_in_history (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  session_id text not null,
  session_label text not null,
  type text not null,                 -- in | out
  leader_id text not null,
  timestamp timestamptz not null default now()
);
create index check_in_history_person_idx on check_in_history(person_id);
create index check_in_history_session_idx on check_in_history(session_id);

create table sign_out_history (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  type text not null,                 -- out | in
  leader_name text not null,
  reason text,
  parents_met boolean,
  author_id text not null,
  timestamp timestamptz not null default now()
);
create index sign_out_history_person_idx on sign_out_history(person_id);

create table classrooms (
  id text primary key,
  name text not null,
  capacity int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table classroom_allocations (
  id text primary key,
  room_id text not null references classrooms(id) on delete cascade,
  church_id text not null,
  gender text not null,               -- male | female
  n int not null default 0,
  bracket text                        -- 7-9 | 10-12 | null (non-split pool)
);
create index classroom_allocations_room_idx on classroom_allocations(room_id);
create index classroom_allocations_church_idx on classroom_allocations(church_id);

create table zones (
  id text primary key,
  name text not null,
  label text not null default '',
  color_hex text not null default '#000000',
  leader_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table groups (
  id text primary key,
  name text not null,
  church_id text,
  zone text,
  leader_id text,
  camper_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notes (
  id text primary key,
  camper_id text,                     -- nullable: general testimony has no student
  body text not null,                 -- encrypted in place
  author_id text not null,
  author_name text not null,
  author_church_id text,
  session_id text,
  category text,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);
create index notes_camper_idx on notes(camper_id);

create table notifications (
  id text primary key,
  scope text not null,                -- camp | zone | church
  zone text,
  church_id text,
  priority text not null default 'normal',
  title text not null,
  body text not null,
  sender_id text,
  sender_name text,
  sender_role text,
  audience_estimate int,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_created_idx on notifications(created_at desc);

create table schedule_items (
  id text primary key,
  day text not null,
  start_time text not null,
  end_time text,
  title text not null,
  location text,
  type text not null,                 -- meal | session | activity | free | logistics
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table devotionals (
  id text primary key,
  day text not null,
  verse text not null,
  reference text not null,
  reflection text not null,
  prayer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table faqs (
  id text primary key,
  question text not null,
  answer text not null,
  "order" int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table settings (
  id text primary key default 'settings',
  camp_name text not null default 'Youth Camp',
  year int not null,
  start_date text not null,
  end_date text not null,
  timezone text not null default 'Australia/Brisbane',
  check_in_banner text,
  check_in_days text[] not null default '{}',
  accommodation_locked boolean not null default false,
  camp_mode text not null default 'pre-camp',   -- pre-camp | at-camp
  last_temp_passwords jsonb,
  last_exported_at timestamptz,
  church_login_locked boolean not null default false,
  zone_leader_login_locked boolean not null default false,
  church_checkin_time_restricted boolean not null default false,
  defaults_saved_at timestamptz,
  form_imported_at timestamptz,
  tickets_imported_at timestamptz,
  invoices_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 'settings')
);

create table defaults (
  id text primary key default 'defaults',
  snapshot jsonb not null,            -- CampDefaults blob (churches/users/.../devotionals)
  created_at timestamptz not null default now(),
  constraint defaults_singleton check (id = 'defaults')
);

create table allocation_overrides (
  id text primary key,
  person_id text not null,
  first_name_key text not null default '',
  last_name_key text not null default '',
  mobile_key text not null default '',
  assigned_church_id text not null,
  assigned_church_name text not null default '',
  form_church text not null default '',
  kind text not null default 'unallocated',
  note text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
