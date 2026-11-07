import { InMemoryBaseRepository } from './in-memory.base.repository';
import type { IPersistenceAdapter } from '../persistence/persistence';
import { NullPersistence } from '../persistence/persistence';

import type { User } from '../../core/entities/user';
import type { Church } from '../../core/entities/church';
import type { Person } from '../../core/entities/person';
import { isCamper } from '../../core/entities/person';
import type { AllocationOverride } from '../../core/entities/allocation-override';
import type { Classroom, RoomAllocation, ClassroomFreeze } from '../../core/entities/accommodation';
import type { StudentNote } from '../../core/entities/note';
import type { Notification } from '../../core/entities/notification';
import type { Incident } from '../../core/entities/incident';
import type { RevealAudit } from '../../core/entities/reveal-audit';
import { MAX_DELIVERY_HISTORY, type PushSubscription } from '../../core/entities/push-subscription';
import type { ScheduleItem } from '../../core/entities/schedule';
import type { Devotional } from '../../core/entities/devotional';
import type { FaqItem } from '../../core/entities/content';
import type { CampSettings, CampDefaults } from '../../core/entities/settings';
import type { UserRole } from '../../core/types/enums';

import type {
  IUserRepository,
  IChurchRepository,
  IAllocationOverrideRepository,
  IPersonRepository,
  IClassroomRepository,
  IAllocationRepository,
  IClassroomFreezeRepository,
  INoteRepository,
  INotificationRepository,
  IIncidentRepository,
  IRevealAuditRepository,
  IPushSubscriptionRepository,
  IScheduleRepository,
  IDevotionalRepository,
  IFaqRepository,
  ISettingsRepository,
  ISnapshotRepository,
} from '../interfaces/entity-repositories';
import { withPresenceWrite, type PresenceDecide } from '../interfaces/entity-repositories';
import { NotFoundError } from '../../core/errors/app-error';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export class InMemoryUserRepository
  extends InMemoryBaseRepository<User>
  implements IUserRepository
{
  constructor(persistence?: IPersistenceAdapter<User>) {
    super(persistence);
  }

  async findByUsername(username: string): Promise<User | null> {
    const lower = username.toLowerCase();
    for (const user of this.store.values()) {
      if (user.username.toLowerCase() === lower) return this.clone(user);
    }
    return null;
  }

  async findByChurch(churchId: string): Promise<User[]> {
    return Array.from(this.store.values())
      .filter((u) => u.churchId === churchId)
      .map((u) => this.clone(u));
  }

  async findByRole(role: UserRole): Promise<User[]> {
    return Array.from(this.store.values())
      .filter((u) => u.role === role)
      .map((u) => this.clone(u));
  }

  /** Keeps every admin account, as the Supabase adapter does (P3 contract, OQ-44). */
  override async deleteAll(): Promise<number> {
    const doomed = [...this.store.values()].filter((u) => u.role !== 'admin');
    for (const u of doomed) this.store.delete(u.id);
    if (doomed.length > 0) await this.writeToPersistence();
    return doomed.length;
  }
}

// ---------------------------------------------------------------------------
// Allocation overrides (manual church allocations that survive re-imports)
// ---------------------------------------------------------------------------
export class InMemoryAllocationOverrideRepository
  extends InMemoryBaseRepository<AllocationOverride>
  implements IAllocationOverrideRepository
{
  constructor(persistence?: IPersistenceAdapter<AllocationOverride>) {
    super(persistence);
  }

  async findByPersonId(personId: string): Promise<AllocationOverride | null> {
    for (const o of this.store.values()) {
      if (o.personId === personId) return this.clone(o);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Churches
// ---------------------------------------------------------------------------
export class InMemoryChurchRepository
  extends InMemoryBaseRepository<Church>
  implements IChurchRepository
{
  constructor(persistence?: IPersistenceAdapter<Church>) {
    super(persistence);
  }

  async findByZone(zone: string): Promise<Church[]> {
    return Array.from(this.store.values())
      .filter((c) => c.zone === zone)
      .map((c) => this.clone(c));
  }
}

// ---------------------------------------------------------------------------
// People (unified registrant + camper — design D2)
// ---------------------------------------------------------------------------
/** Check-in history in Supabase hydrate order `(timestamp, id)`, so N5's "last entry" is the
 *  same row the B-5 SQL guard picks (`timestamp desc, id desc`) on an exact-ms tie. */
function hydrateOrder(p: Person): Person {
  const checkInHistory = [...p.checkInHistory].sort((a, b) =>
    Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...p, checkInHistory };
}

export class InMemoryPersonRepository
  extends InMemoryBaseRepository<Person>
  implements IPersonRepository
{
  constructor(persistence?: IPersistenceAdapter<Person>) {
    super(persistence);
  }

  /** P3: an UPDATE keeps the stored presence (atCamp, lifecycle, cancelledAt, both histories);
   *  only transition/transitionMany/clearPresence write it. An INSERT stores the person as given. */
  private keepPresence(p: Person): Person {
    const stored = this.store.get(p.id);
    if (!stored) return p;
    return {
      ...p,
      atCamp: stored.atCamp,
      lifecycle: stored.lifecycle,
      cancelledAt: stored.cancelledAt,
      checkInHistory: stored.checkInHistory,
      signOutHistory: stored.signOutHistory,
    };
  }

  override async save(person: Person): Promise<Person> {
    return super.save(this.keepPresence(person));
  }

  override async saveMany(people: Person[]): Promise<Person[]> {
    return super.saveMany(people.map((p) => this.keepPresence(p)));
  }

  /** Decide on the stored row and write in one synchronous step (atomic in one Node process). */
  async transition(id: string, decide: PresenceDecide): Promise<Person> {
    const stored = this.store.get(id);
    if (!stored) throw new NotFoundError('Person not found');
    const w = decide(this.clone(stored));
    if (!w) return this.clone(stored);
    const next = hydrateOrder(withPresenceWrite(stored, w));
    this.store.set(id, this.clone(next));
    await this.writeToPersistence();
    return this.clone(next);
  }

  /** All-or-nothing: every decision runs before anything is stored, so a throw writes nothing. */
  async transitionMany(ids: string[], decide: PresenceDecide): Promise<Person[]> {
    const out: Person[] = [];
    let changed = false;
    for (const id of [...new Set(ids)].sort()) {
      const stored = this.store.get(id);
      if (!stored) continue;
      const w = decide(this.clone(stored));
      if (w) changed = true;
      out.push(w ? hydrateOrder(withPresenceWrite(stored, w)) : stored);
    }
    if (changed) {
      for (const p of out) this.store.set(p.id, this.clone(p));
      await this.writeToPersistence();
    }
    return out.map((p) => this.clone(p));
  }

  async clearPresence(now: string): Promise<number> {
    let n = 0;
    for (const p of this.store.values()) {
      if (!p.atCamp && p.checkInHistory.length === 0 && p.signOutHistory.length === 0) continue;
      n++;
      p.atCamp = false;
      if (p.lifecycle !== 'cancelled' && p.lifecycle !== 'registered') p.lifecycle = 'registered';
      p.checkInHistory = [];
      p.signOutHistory = [];
      p.updatedAt = now;
    }
    if (n > 0) await this.writeToPersistence();
    return n;
  }

  async search(q: string): Promise<Person[]> {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return Array.from(this.store.values())
      .filter((p) => {
        const full = `${p.firstName} ${p.lastName}`.toLowerCase();
        return terms.every((t) => full.includes(t));
      })
      .map((p) => this.clone(p));
  }

  async findByChurch(churchId: string): Promise<Person[]> {
    return Array.from(this.store.values())
      .filter((p) => p.churchId === churchId)
      .map((p) => this.clone(p));
  }

  async findByZone(zone: string): Promise<Person[]> {
    return Array.from(this.store.values())
      .filter((p) => p.zone === zone)
      .map((p) => this.clone(p));
  }

  // deleteAll() is inherited from InMemoryBaseRepository (bulk clear, defect A3).
}

// ---------------------------------------------------------------------------
// Classrooms (reusable scaffold rooms)
// ---------------------------------------------------------------------------
export class InMemoryClassroomRepository
  extends InMemoryBaseRepository<Classroom>
  implements IClassroomRepository
{
  constructor(persistence?: IPersistenceAdapter<Classroom>) {
    super(persistence);
  }
}

// ---------------------------------------------------------------------------
// Allocations (classroom placement rows)
// ---------------------------------------------------------------------------
export class InMemoryAllocationRepository
  extends InMemoryBaseRepository<RoomAllocation>
  implements IAllocationRepository
{
  constructor(persistence?: IPersistenceAdapter<RoomAllocation>) {
    super(persistence);
  }

  async findByRoom(roomId: string): Promise<RoomAllocation[]> {
    return Array.from(this.store.values())
      .filter((a) => a.roomId === roomId)
      .map((a) => this.clone(a));
  }
}

export class InMemoryClassroomFreezeRepository
  extends InMemoryBaseRepository<ClassroomFreeze>
  implements IClassroomFreezeRepository
{
  constructor(persistence?: IPersistenceAdapter<ClassroomFreeze>) {
    super(persistence);
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
export class InMemoryNoteRepository
  extends InMemoryBaseRepository<StudentNote>
  implements INoteRepository
{
  constructor(persistence?: IPersistenceAdapter<StudentNote>) {
    super(persistence);
  }

  async findByCamper(camperId: string): Promise<StudentNote[]> {
    return Array.from(this.store.values())
      .filter((n) => n.camperId === camperId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => this.clone(n));
  }

  async findByZone(zone: string, limit = 50): Promise<StudentNote[]> {
    // Notes don't have zone directly; look up via camper zone is done at service level.
    // Here we return all notes (zone filtering at service layer).
    return Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((n) => this.clone(n));
  }

  async findRecent(limit: number): Promise<StudentNote[]> {
    return Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((n) => this.clone(n));
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export class InMemoryNotificationRepository
  extends InMemoryBaseRepository<Notification>
  implements INotificationRepository
{
  constructor(persistence?: IPersistenceAdapter<Notification>) {
    super(persistence);
  }

  async findByZone(zone: string): Promise<Notification[]> {
    return Array.from(this.store.values())
      .filter((n) => n.zone === zone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => this.clone(n));
  }

  async findByChurch(churchId: string): Promise<Notification[]> {
    return Array.from(this.store.values())
      .filter((n) => n.churchId === churchId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => this.clone(n));
  }

  async findActive(): Promise<Notification[]> {
    const now = new Date().toISOString();
    return Array.from(this.store.values())
      .filter((n) => !n.expiresAt || n.expiresAt > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => this.clone(n));
  }

  /**
   * Mirrors the partial unique index on `dedupe_key` from migration 0013 (`unique … where
   * dedupe_key is not null`), including the SQLSTATE the caller checks for.
   *
   * Without this the scheduler's dedupe existed ONLY on Supabase: in dev and in tests every
   * tick inside the 60-minute lead window happily created another duplicate notice, and
   * cron.service's 23505 branch was unreachable except by a hand-faked error. Same behaviour
   * in both backends is the point.
   */
  override async save(n: Notification): Promise<Notification> {
    if (n.dedupeKey != null) {
      for (const existing of this.store.values()) {
        if (existing.dedupeKey === n.dedupeKey && existing.id !== n.id) {
          const err = new Error(
            `duplicate key value violates unique constraint "notifications_dedupe_key_idx"`,
          ) as Error & { code: string };
          err.code = '23505';
          throw err;
        }
      }
    }
    // B-6: only claimForPush sets pushSentAt and nothing un-sets it, so a whole-row save
    // (an edit that read the row before a claim) keeps the stored claim. Mirrors the coalesce
    // in the Supabase upsert.
    const stored = this.store.get(n.id);
    if (stored?.pushSentAt != null) n = { ...n, pushSentAt: stored.pushSentAt };
    return super.save(n);
  }

  async claimForPush(ids: string[]): Promise<string[]> {
    const claimed: string[] = [];
    const now = new Date().toISOString();
    for (const id of ids) {
      const n = this.store.get(id);
      if (n && n.pushSentAt == null) {
        n.pushSentAt = now;
        claimed.push(id);
      }
    }
    return claimed;
  }
}

// ---------------------------------------------------------------------------
// Incidents (Feature 3)
// ---------------------------------------------------------------------------
export class InMemoryIncidentRepository
  extends InMemoryBaseRepository<Incident>
  implements IIncidentRepository
{
  constructor(persistence?: IPersistenceAdapter<Incident>) {
    super(persistence);
  }

  async findRecent(limit?: number): Promise<Incident[]> {
    const sorted = Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((i) => this.clone(i));
    return limit != null ? sorted.slice(0, limit) : sorted;
  }
}

// ---------------------------------------------------------------------------
// Reveal audit
// ---------------------------------------------------------------------------
export class InMemoryRevealAuditRepository
  extends InMemoryBaseRepository<RevealAudit>
  implements IRevealAuditRepository
{
  constructor(persistence?: IPersistenceAdapter<RevealAudit>) {
    super(persistence);
  }

  async findRecent(limit?: number): Promise<RevealAudit[]> {
    const sorted = Array.from(this.store.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => this.clone(r));
    return limit != null ? sorted.slice(0, limit) : sorted;
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------
export class InMemoryScheduleRepository
  extends InMemoryBaseRepository<ScheduleItem>
  implements IScheduleRepository
{
  constructor(persistence?: IPersistenceAdapter<ScheduleItem>) {
    super(persistence);
  }

  async findByDay(day: string): Promise<ScheduleItem[]> {
    return Array.from(this.store.values())
      .filter((s) => s.day === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => this.clone(s));
  }

  async replaceDay(day: string, items: ScheduleItem[]): Promise<ScheduleItem[]> {
    for (const [id, s] of this.store) {
      if (s.day === day) this.store.delete(id);
    }
    for (const item of items) {
      this.store.set(item.id, this.clone(item));
    }
    await this.writeToPersistence();
    return items.map((i) => this.clone(i));
  }
}

// ---------------------------------------------------------------------------
// Devotionals
// ---------------------------------------------------------------------------
export class InMemoryDevotionalRepository
  extends InMemoryBaseRepository<Devotional>
  implements IDevotionalRepository
{
  constructor(persistence?: IPersistenceAdapter<Devotional>) {
    super(persistence);
  }

  async findByDay(day: string): Promise<Devotional | null> {
    for (const d of this.store.values()) {
      if (d.day === day) return this.clone(d);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------
export class InMemoryFaqRepository
  extends InMemoryBaseRepository<FaqItem>
  implements IFaqRepository
{
  constructor(persistence?: IPersistenceAdapter<FaqItem>) {
    super(persistence);
  }

  async findOrdered(): Promise<FaqItem[]> {
    return Array.from(this.store.values())
      .sort((a, b) => a.order - b.order)
      .map((f) => this.clone(f));
  }
}

// ---------------------------------------------------------------------------
// Settings (singleton)
// ---------------------------------------------------------------------------
export class InMemorySettingsRepository implements ISettingsRepository {
  private settings: CampSettings | null = null;
  private persistence: IPersistenceAdapter<CampSettings>;

  constructor(persistence?: IPersistenceAdapter<CampSettings>) {
    this.persistence = persistence ?? new NullPersistence<CampSettings>();
  }

  async init(): Promise<void> {
    const items = await this.persistence.read();
    this.settings = items[0] ?? null;
  }

  async getSingleton(): Promise<CampSettings | null> {
    return this.settings ? (JSON.parse(JSON.stringify(this.settings)) as CampSettings) : null;
  }

  async saveSingleton(settings: CampSettings): Promise<CampSettings> {
    this.settings = JSON.parse(JSON.stringify(settings)) as CampSettings;
    await this.persistence.write(this.settings ? [this.settings] : []);
    return JSON.parse(JSON.stringify(this.settings)) as CampSettings;
  }

  async patchSingleton(fields: Partial<CampSettings>): Promise<CampSettings> {
    if (!this.settings) throw new Error('Settings row missing; nothing to patch');
    // Same contract as Supabase patchCols: undefined is skipped, id/createdAt are never written.
    const { id: _id, createdAt: _c, ...rest } = fields;
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    return this.saveSingleton({ ...this.settings, ...defined, updatedAt: fields.updatedAt ?? new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// Snapshots / Defaults
// ---------------------------------------------------------------------------
export class InMemorySnapshotRepository implements ISnapshotRepository {
  private defaults: CampDefaults | null = null;
  private persistence: IPersistenceAdapter<CampDefaults>;

  constructor(persistence?: IPersistenceAdapter<CampDefaults>) {
    this.persistence = persistence ?? new NullPersistence<CampDefaults>();
  }

  async init(): Promise<void> {
    const items = await this.persistence.read();
    this.defaults = items[0] ?? null;
  }

  async getDefaults(): Promise<CampDefaults | null> {
    return this.defaults ? (JSON.parse(JSON.stringify(this.defaults)) as CampDefaults) : null;
  }

  async saveDefaults(defaults: CampDefaults): Promise<CampDefaults> {
    this.defaults = JSON.parse(JSON.stringify(defaults)) as CampDefaults;
    await this.persistence.write(this.defaults ? [this.defaults] : []);
    return JSON.parse(JSON.stringify(this.defaults)) as CampDefaults;
  }
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------
export class InMemoryPushSubscriptionRepository
  extends InMemoryBaseRepository<PushSubscription>
  implements IPushSubscriptionRepository
{
  constructor(persistence?: IPersistenceAdapter<PushSubscription>) {
    super(persistence);
  }

  async findByUser(userId: string): Promise<PushSubscription[]> {
    return Array.from(this.store.values())
      .filter((s) => s.userId === userId)
      .map((s) => this.clone(s));
  }

  async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    const hit = Array.from(this.store.values()).find((s) => s.endpoint === endpoint);
    return hit ? this.clone(hit) : null;
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const hit = Array.from(this.store.values()).find((s) => s.endpoint === endpoint);
    if (!hit) return false;
    return this.delete(hit.id);
  }

  async deleteByUser(userId: string): Promise<number> {
    const hits = Array.from(this.store.values()).filter((s) => s.userId === userId);
    for (const h of hits) await this.delete(h.id);
    return hits.length;
  }

  /**
   * Mirrors the Supabase on-conflict rule so tests exercise the real semantics: an ordinary
   * save never overwrites deliveryHistory (only recordSuccess writes it), EXCEPT that moving
   * the row to a different account takes the incoming (cleared) history.
   */
  override async save(s: PushSubscription): Promise<PushSubscription> {
    const prev = this.store.get(s.id);
    const keep = prev && prev.userId === s.userId;
    return super.save({ ...s, deliveryHistory: keep ? prev.deliveryHistory ?? [] : s.deliveryHistory ?? [] });
  }

  async recordSuccess(endpoint: string, at: string): Promise<void> {
    const hit = Array.from(this.store.values()).find((s) => s.endpoint === endpoint);
    if (!hit) return;
    const history = [at, ...(hit.deliveryHistory ?? [])].slice(0, MAX_DELIVERY_HISTORY);
    await super.save({ ...hit, lastSuccessAt: at, failureCount: 0, deliveryHistory: history });
  }
}
