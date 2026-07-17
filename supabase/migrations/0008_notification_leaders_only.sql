-- 0008: leaders-only notifications
-- Incident high-severity alerts raise a notification whose body can describe a minor.
-- This flag keeps such notices off church/firstAid feeds even at 'camp' scope
-- (filtered in notification.service.ts getActorFeed). Default false = existing
-- behaviour for every normal broadcast.

alter table notifications
  add column if not exists leaders_only boolean not null default false;
