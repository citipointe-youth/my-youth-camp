import { createAppInstance } from '../src/app';
import type { Express, Request, Response } from 'express';

let appPromise: Promise<Express> | undefined;

function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = createAppInstance().catch((err: unknown) => {
      console.error('[api] App init failed:', err);
      appPromise = undefined;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    const app = await getApp();
    app(req, res);
  } catch (err) {
    console.error('[api] Handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
