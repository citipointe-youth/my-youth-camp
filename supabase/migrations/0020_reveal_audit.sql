-- 0020: reveal_audit — who revealed a masked sensitive value, and when (2026-07-31).
--
-- Before this table the ONLY trail for a Medicare or parent-contact reveal was a
-- `logger.info('[audit] …')` line in the Vercel runtime logs, which the owner cannot read,
-- cannot export, and which rolls off. This makes those reveals a durable, exportable record —
-- it appears as the "Sensitive Reveals" sheet in the compliance workbook.
--
-- ⚠️ THE REVEALED VALUE IS DELIBERATELY NOT STORED. No Medicare number, no phone number, no
-- fragment of either. `people.medicare_number` and `people.parent_phone` are encrypted at rest
-- precisely so a database reader cannot see them; an audit table holding a plaintext copy of
-- every value anyone ever looked at would hand back exactly what that encryption removes.
-- If a column that could carry one is ever added here, it needs the field-crypto envelope —
-- and it almost certainly should not exist.
--
-- `person_name` / `church_name` are denormalised on purpose: the audit has to stay readable
-- after a new-year rollover deletes the person, and there is no FK to `people` for the same
-- reason (a cascade would erase the record of the reveal along with its subject).
create table if not exists reveal_audit (
  id text primary key,
  kind text not null,                 -- medicare | parent-contact | leader-contact
  person_id text not null,            -- intentionally NOT a foreign key (see above)
  person_name text not null default '',
  church_name text not null default '',
  actor_id text not null,
  actor_username text not null default '',
  actor_role text not null,
  actor_initials text not null default '',
  contact_role text,                  -- e.g. male-primary; null for a medicare reveal
  created_at timestamptz not null default now()
);
create index if not exists reveal_audit_created_idx on reveal_audit(created_at desc);
create index if not exists reveal_audit_person_idx on reveal_audit(person_id);

-- Constrain `kind` to the three legal values so a typo can't silently create a fourth
-- category that the export then groups separately. Guarded so the migration is re-runnable
-- (Postgres has no `add constraint if not exists`).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reveal_audit_kind_chk'
  ) then
    alter table reveal_audit
      add constraint reveal_audit_kind_chk
      check (kind in ('medicare', 'parent-contact', 'leader-contact'));
  end if;
end $$;

-- RLS on, consistent with every other live table (the Express API connects as the postgres
-- superuser via DATABASE_URL, which BYPASSES RLS; the anon key is denied all rows).
alter table reveal_audit enable row level security;
