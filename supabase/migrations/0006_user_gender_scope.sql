-- 0006: Gender-scoped church accounts (Feature 2).
--
-- Every church is split into two gender-scoped logins: b-<slug> (scoped to the church's
-- MALE students + leaders) and g-<slug> (FEMALE). The scope is stored on the user row.
-- null = not gender-scoped = sees all genders (every non-church role, plus any legacy
-- account). Backward-compatible & idempotent — existing rows default to null.
alter table users add column if not exists gender_scope text;

-- Constrain to the three legal values (null / 'male' / 'female'). Guarded so the migration
-- is safely re-runnable (Postgres has no `add constraint if not exists`).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_gender_scope_chk'
  ) then
    alter table users
      add constraint users_gender_scope_chk
      check (gender_scope is null or gender_scope in ('male', 'female'));
  end if;
end $$;
