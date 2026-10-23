/**
 * Insights API calls: the JSON of a range, and its CSV saved as a file. The CSV is fetched
 * with the session's bearer token (a plain link would carry none), then handed to the
 * browser as a download.
 */
import type { ApiErrorBody, SpaceInsights } from '@enbox/shared';
import { ApiError, api, apiUrl, getApiToken } from '@/lib/api';
import type { InsightsRange } from './summary';

export function fetchInsights(
  spaceId: string,
  days: InsightsRange,
  signal?: AbortSignal,
): Promise<SpaceInsights> {
  return api.get<SpaceInsights>(`/api/spaces/${spaceId}/insights`, { query: { days }, signal });
}

export function insightsCsvUrl(spaceId: string, days: InsightsRange): string {
  return apiUrl(`/api/spaces/${spaceId}/insights.csv`, { days });
}

/** Save the range's CSV (`insights-<day>-<n>d.csv`, the server's name). */
export async function downloadInsightsCsv(spaceId: string, days: InsightsRange): Promise<void> {
  const token = getApiToken();
  let res: Response;
  try {
    res = await fetch(insightsCsvUrl(spaceId, days), {
      headers: { Accept: 'text/csv', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ApiError('network_error', 'Could not download the CSV');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(
      body?.error?.code ?? 'internal_error',
      body?.error?.message ?? 'Could not download the CSV',
      res.status,
    );
  }
  const csv = await res.text();
  // The header may be hidden cross-origin (VITE_API_URL): the same name, from the UTC day.
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    `insights-${new Date().toISOString().slice(0, 10)}-${days}d.csv`;
  saveFile(name, csv, 'text/csv;charset=utf-8');
}

function saveFile(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
