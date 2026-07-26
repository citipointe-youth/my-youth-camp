import type { Actor } from '../../core/entities/user';

export interface RequestContext {
  actor: Actor;
  token: string;
}

export interface HttpRequest {
  ctx: RequestContext | null;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  ip?: string;
  /**
   * Lower-cased request headers. Populated by the Express adapter. Optional because
   * controller unit tests construct `HttpRequest` literals directly and must not be
   * forced to supply it. Array-valued headers are collapsed to their first value.
   * Added for the `/internal/cron/tick` bearer-secret guard, which cannot use the
   * app's normal auth layer.
   */
  headers?: Record<string, string | undefined>;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: boolean;
  // If true, this route stays reachable for an actor with mustChangePassword set —
  // everything else 403s (MUST_CHANGE_PASSWORD) until the password is changed.
  // Only /auth/me, /auth/logout, and /accounts/me/password should ever need this.
  allowMustChangePassword?: boolean;
  handler(req: HttpRequest): Promise<unknown>;
}

export interface BufferRoute {
  method: 'GET' | 'POST';
  path: string;
  auth: boolean;
  contentType: string;
  filename: string;
  bufferHandler(req: HttpRequest): Promise<Buffer>;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
