export interface CalloutRow {
  id: string;
  mint: string;
  createdAt: number;
  supported: boolean;
  entryCap: number | null;
  current: number | null;
  peak: number | null;
}
export interface CalloutSnapshot {
  profile: { id: string; username: string; address: string };
  rows: CalloutRow[];
  fetchedAt: number;
  asOf: number;
  pages: number;
  complete: boolean;
  issues: string[];
  source: 'pump';
}
export const PAGE_LIMIT: number;
export const MAX_PAGES: number;
export function parseProfile(value: unknown): string;
export function getJson(url: string, fetcher: typeof fetch): Promise<unknown>;
export function createPacedFetcher(fetcher?: typeof fetch, options?: {
  gapMs?: number; clock?: () => number; wait?: (ms: number) => Promise<void>;
}): typeof fetch;
export function loadProfile(input: string, options?: {
  fetcher?: typeof fetch; now?: number; maxPages?: number;
}): Promise<CalloutSnapshot>;
