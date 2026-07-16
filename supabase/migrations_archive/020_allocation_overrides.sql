-- 020: Church allocation overrides.
--
-- Persistent record that a person's church was set MANUALLY (allocating an "OTHER –
-- please specify" registrant, or overriding a wrong church). The Form importer re-applies
-- these by name+mobile identity so a manual allocation wins on every re-import and is not
-- deleted by the delete-absent sweep. Purged by reset / new-year.
create table if not exists allocation_overrides (
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
