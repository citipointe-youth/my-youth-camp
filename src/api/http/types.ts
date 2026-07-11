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
