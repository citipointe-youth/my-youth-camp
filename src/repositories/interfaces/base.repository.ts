export interface IRepository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  /**
   * Persist many records, returning them in input order. Replaces per-row save loops (defect
   * C1): the in-memory store writes its JSON file once. On Supabase most adapters still upsert
   * row by row; only `people`, `users` and `notifications` do it inside one transaction
   * (all-or-nothing). Others can fail part-way (scaffold repos, rare admin writes; OQ-45).
   */
  saveMany(entities: T[]): Promise<T[]>;
  delete(id: string): Promise<boolean>;
  /**
   * Bulk-remove every record, returning the count deleted (defect A3: one statement, not N).
   * Supabase uses `delete … returning id`. Exception: users keep every admin (both adapters).
   */
  deleteAll(): Promise<number>;
  init(): Promise<void>;
}
