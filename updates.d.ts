import type { CalloutSnapshot } from './api.js';
export interface CalloutUpdates {
  rows: { id: string; calloutId: string; mint: string; createdAt: number; text: string }[];
  checked: number;
  issues: string[];
  fetchedAt: number;
}
export function loadUpdates(snapshot: CalloutSnapshot, options?: { fetcher?: typeof fetch }): Promise<CalloutUpdates>;
