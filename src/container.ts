import { env } from './config/env';
import { join } from 'node:path';

// Repositories
import {
  InMemoryUserRepository,
  InMemoryChurchRepository,
  InMemoryAllocationOverrideRepository,
  InMemoryPersonRepository,
  InMemoryClassroomRepository,
  InMemoryAllocationRepository,
  InMemoryClassroomFreezeRepository,
  InMemoryNoteRepository,
  InMemoryNotificationRepository,
  InMemoryIncidentRepository,
  InMemoryRevealAuditRepository,
  InMemoryScheduleRepository,
  InMemoryDevotionalRepository,
  InMemoryFaqRepository,
  InMemorySettingsRepository,
  InMemorySnapshotRepository,
  InMemoryPushSubscriptionRepository,
} from './repositories/in-memory';
import { JsonFilePersistence } from './repositories/persistence';
import {
  SupabaseUserRepository,
  SupabaseChurchRepository,
  SupabaseAllocationOverrideRepository,
  SupabasePersonRepository,
  SupabaseClassroomRepository,
  SupabaseAllocationRepository,
  SupabaseClassroomFreezeRepository,
  SupabaseNoteRepository,
  SupabaseNotificationRepository,
  SupabaseIncidentRepository,
  SupabaseRevealAuditRepository,
  SupabaseScheduleRepository,
  SupabaseDevotionalRepository,
  SupabaseFaqRepository,
  SupabaseSettingsRepository,
  SupabaseDefaultsRepository,
  SupabasePushSubscriptionRepository,
} from './repositories/supabase';
import { getSqlClient, type SqlClient } from './repositories/supabase/client';
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
  IScheduleRepository,
  IDevotionalRepository,
  IFaqRepository,
  ISettingsRepository,
  ISnapshotRepository,
  IPushSubscriptionRepository,
} from './repositories/interfaces';
import type { User } from './core/entities/user';
import type { Church } from './core/entities/church';
import type { Person } from './core/entities/person';
import type { AllocationOverride } from './core/entities/allocation-override';
import type { Classroom, RoomAllocation, ClassroomFreeze } from './core/entities/accommodation';
import type { StudentNote } from './core/entities/note';
import type { Notification } from './core/entities/notification';
import type { Incident } from './core/entities/incident';
import type { RevealAudit } from './core/entities/reveal-audit';
import type { ScheduleItem } from './core/entities/schedule';
import type { Devotional } from './core/entities/devotional';
import type { FaqItem } from './core/entities/content';
import type { CampSettings, CampDefaults } from './core/entities/settings';
import type { PushSubscription } from './core/entities/push-subscription';

// Services
import { makeAuthService, type AuthService } from './services/auth.service';
import { makeSettingsService, type SettingsService } from './services/settings.service';
import { makeAccommodationService, type AccommodationService } from './services/accommodation.service';
import { makeCheckInService, type CheckInService } from './services/checkin.service';
import { makeNotificationService, type NotificationService } from './services/notification.service';
import { makeIncidentService, type IncidentService } from './services/incident.service';
import { makeRevealAuditService, type RevealAuditService } from './services/reveal-audit.service';
import { makeSearchService, type SearchService } from './services/search.service';
import { makeNoteService, type NoteService } from './services/note.service';
import { makeScheduleService, type ScheduleService } from './services/schedule.service';
import { makeContentService, type ContentService } from './services/content.service';
import { makeImportService, type ImportService } from './services/import.service';
import { makeExportService, type ExportService } from './services/export.service';
import { makeAccountService, type AccountService } from './services/account.service';
import { makeDashboardService, type DashboardService } from './services/dashboard.service';
import { makeAdminService, type AdminService } from './services/admin.service';
import { makePersonService, type PersonService } from './services/person.service';
import { makeAllocationService, type AllocationService } from './services/allocation.service';
import { makeTicketImportService, type TicketImportService } from './services/ticket-import.service';
import { makeInvoiceImportService, type InvoiceImportService } from './services/invoice-import.service';
import { makeAuditExportService, type AuditExportService } from './services/audit-export.service';
import { makeOfflineSignInService, type OfflineSignInService } from './services/offline-signin.service';
import { makeCronService, type CronService } from './services/cron.service';
import { makePushService, type PushService } from './services/push.service';
import { makePushSubscriptionService, type PushSubscriptionService } from './services/push-subscription.service';

export interface Repositories {
  users: IUserRepository;
  churches: IChurchRepository;
  allocationOverrides: IAllocationOverrideRepository;
  people: IPersonRepository;
  classrooms: IClassroomRepository;
  allocations: IAllocationRepository;
  classroomFreeze: IClassroomFreezeRepository;
  notes: INoteRepository;
  notifications: INotificationRepository;
  incidents: IIncidentRepository;
  revealAudit: IRevealAuditRepository;
  schedule: IScheduleRepository;
  devotionals: IDevotionalRepository;
  faqs: IFaqRepository;
  settings: ISettingsRepository;
  snapshots: ISnapshotRepository;
  pushSubscriptions: IPushSubscriptionRepository;
}

export interface Services {
  auth: AuthService;
  settings: SettingsService;
  person: PersonService;
  accommodation: AccommodationService;
  checkIn: CheckInService;
  notification: NotificationService;
  incident: IncidentService;
  revealAudit: RevealAuditService;
  search: SearchService;
  note: NoteService;
  schedule: ScheduleService;
  content: ContentService;
  importService: ImportService;
  exportService: ExportService;
  allocation: AllocationService;
  ticketImport: TicketImportService;
  invoiceImport: InvoiceImportService;
  auditExport: AuditExportService;
  offlineSignIn: OfflineSignInService;
  account: AccountService;
  dashboard: DashboardService;
  admin: AdminService;
  pushSubscriptions: PushSubscriptionService;
  cron: CronService;
  push: PushService;
}

export interface Container {
  repos: Repositories;
  services: Services;
}

/** Supabase adapter: every repo shares one pooled SQL client. */
export function supabaseRepos(sql: SqlClient): Repositories {
  return {
    users: new SupabaseUserRepository(sql),
    churches: new SupabaseChurchRepository(sql),
    allocationOverrides: new SupabaseAllocationOverrideRepository(sql),
    people: new SupabasePersonRepository(sql),
    classrooms: new SupabaseClassroomRepository(sql),
    allocations: new SupabaseAllocationRepository(sql),
    classroomFreeze: new SupabaseClassroomFreezeRepository(sql),
    notes: new SupabaseNoteRepository(sql),
    notifications: new SupabaseNotificationRepository(sql),
    incidents: new SupabaseIncidentRepository(sql),
    revealAudit: new SupabaseRevealAuditRepository(sql),
    schedule: new SupabaseScheduleRepository(sql),
    devotionals: new SupabaseDevotionalRepository(sql),
    faqs: new SupabaseFaqRepository(sql),
    settings: new SupabaseSettingsRepository(sql),
    snapshots: new SupabaseDefaultsRepository(sql),
    pushSubscriptions: new SupabasePushSubscriptionRepository(sql),
  };
}

/**
 * In-memory adapter. With `dataDir` each repo is snapshotted to `<dataDir>/<file>.json`
 * (PERSISTENCE=json); without it, state lives only in this process (tests, PERSISTENCE=memory).
 */
export function memoryRepos(opts: { dataDir?: string } = {}): Repositories {
  const { dataDir } = opts;
  const file = <T>(name: string) => (dataDir ? new JsonFilePersistence<T>(join(dataDir, name)) : undefined);
  return {
    users: new InMemoryUserRepository(file<User>('users.json')),
    churches: new InMemoryChurchRepository(file<Church>('churches.json')),
    allocationOverrides: new InMemoryAllocationOverrideRepository(file<AllocationOverride>('allocation-overrides.json')),
    people: new InMemoryPersonRepository(file<Person>('people.json')),
    classrooms: new InMemoryClassroomRepository(file<Classroom>('classrooms.json')),
    allocations: new InMemoryAllocationRepository(file<RoomAllocation>('allocations.json')),
    classroomFreeze: new InMemoryClassroomFreezeRepository(file<ClassroomFreeze>('classroom-freeze.json')),
    notes: new InMemoryNoteRepository(file<StudentNote>('notes.json')),
    notifications: new InMemoryNotificationRepository(file<Notification>('notifications.json')),
    incidents: new InMemoryIncidentRepository(file<Incident>('incidents.json')),
    revealAudit: new InMemoryRevealAuditRepository(file<RevealAudit>('reveal-audit.json')),
    schedule: new InMemoryScheduleRepository(file<ScheduleItem>('schedule.json')),
    devotionals: new InMemoryDevotionalRepository(file<Devotional>('devotionals.json')),
    faqs: new InMemoryFaqRepository(file<FaqItem>('faqs.json')),
    settings: new InMemorySettingsRepository(file<CampSettings>('settings.json')),
    snapshots: new InMemorySnapshotRepository(file<CampDefaults>('snapshots.json')),
    pushSubscriptions: new InMemoryPushSubscriptionRepository(file<PushSubscription>('push-subscriptions.json')),
  };
}

/** Init every repo in parallel (no-ops on Supabase; JSON load in memory/json). */
export async function initRepos(repos: Repositories): Promise<void> {
  await Promise.all(Object.values(repos).map((r) => r.init()));
}

/** The service graph. Pure and synchronous; the only place it is wired. */
export function buildServices(repos: Repositories): Services {
  const {
    users, churches, allocationOverrides, people, classrooms, allocations, classroomFreeze,
    notes, notifications, incidents, revealAudit, schedule: scheduleRepo, devotionals, faqs,
    settings: settingsRepo, snapshots, pushSubscriptions,
  } = repos;

  const auth = makeAuthService(users, settingsRepo);
  // Item 3 (2026-07-28): the devotional + schedule repos let a camp-date change carry day-keyed
  // content across to the new dates (see remapDays in settings.service.ts).
  const settings = makeSettingsService(settingsRepo, { devotionals, schedule: scheduleRepo });
  const personSvc = makePersonService(people, settingsRepo);
  const accommodationSvc = makeAccommodationService(classrooms, allocations, churches, settingsRepo, people, classroomFreeze);
  const checkIn = makeCheckInService(people, settingsRepo);
  // ⚠ `push` is constructed BEFORE notification/incident (moved 2026-08-03). Both of those
  // take it so an urgent notice / high-severity incident alert is pushed the moment it is
  // created rather than waiting up to 5 minutes for the cron tick. `push` has no dependency
  // on either service, so the ordering is free.
  const push = makePushService({
    subscriptions: pushSubscriptions,
    notifications,
    users,
    settings: settingsRepo,
  });
  const notification = makeNotificationService(notifications, push, { users, settings: settingsRepo });
  const incident = makeIncidentService(incidents, notifications, push);
  const revealAuditSvc = makeRevealAuditService(revealAudit, users);
  const search = makeSearchService(people, churches, revealAuditSvc);
  const note = makeNoteService(notes, people);
  const schedule = makeScheduleService(scheduleRepo);
  const content = makeContentService(faqs, devotionals);
  const importSvc = makeImportService(people, churches, allocationOverrides);
  const exportSvc = makeExportService(people, churches, allocationOverrides);
  const allocation = makeAllocationService(people, churches, allocationOverrides);
  const ticketImportSvc = makeTicketImportService(people, churches);
  const invoiceImportSvc = makeInvoiceImportService(people);
  const auditExportSvc = makeAuditExportService(people, notes, incidents, settingsRepo, revealAudit);
  const offlineSignInSvc = makeOfflineSignInService(people, settingsRepo);
  const account = makeAccountService(users, churches, people);
  const dashboard = makeDashboardService(people, notifications, churches);
  const admin = makeAdminService(
    users, churches, people, classrooms, allocations, faqs, scheduleRepo,
    notifications, notes, devotionals, settingsRepo, snapshots, allocationOverrides,
    incidents, pushSubscriptions, revealAudit, classroomFreeze,
  );
  const cron = makeCronService({ notifications, people, users, settings: settingsRepo, push });

  return {
    auth, settings, person: personSvc, accommodation: accommodationSvc,
    checkIn, notification, incident, revealAudit: revealAuditSvc, search, note, schedule, content,
    importService: importSvc, exportService: exportSvc, allocation,
    ticketImport: ticketImportSvc, invoiceImport: invoiceImportSvc,
    auditExport: auditExportSvc, offlineSignIn: offlineSignInSvc,
    account, dashboard, admin, cron, push,
    pushSubscriptions: makePushSubscriptionService(pushSubscriptions, users),
  };
}

/** Production/dev entry: pick the adapter by `env.PERSISTENCE`, init, wire. */
export async function buildContainer(): Promise<Container> {
  const repos = env.PERSISTENCE === 'supabase'
    ? supabaseRepos(getSqlClient())
    : memoryRepos({ dataDir: env.PERSISTENCE === 'json' ? env.DATA_DIR : undefined });
  await initRepos(repos);
  return { repos, services: buildServices(repos) };
}

/** Fresh in-memory container for tests (no `env`, no disk). */
export async function buildMemoryContainer(): Promise<Container> {
  const repos = memoryRepos();
  await initRepos(repos);
  return { repos, services: buildServices(repos) };
}
