// «Τι νέο» in the ⓘ sheet: the web's GitHub Releases, written in Greek for users. Read from the
// browser (60 unauthenticated requests per hour per IP, plenty for one sheet).
export const RELEASES_URL = "https://api.github.com/repos/angelospk/athens-transit-map/releases?per_page=5";
export const RELEASES_PAGE = "https://github.com/angelospk/athens-transit-map/releases";

export interface Release { tag: string; title: string; date: string; url: string; notes: string[] }

interface ApiRelease { tag_name: string; name: string | null; html_url: string; published_at: string | null; draft: boolean; prerelease: boolean; body: string | null }

export function parseReleases(json: unknown): Release[] {
  if (!Array.isArray(json)) return [];
  return (json as ApiRelease[])
    .filter(r => !r.draft && r.published_at)
    .map(r => ({
      tag: r.tag_name,
      title: r.name || r.tag_name,
      date: r.published_at!.slice(0, 10),
      url: r.html_url,
      notes: (r.body ?? "").split(/\r?\n/).map(l => l.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function fetchReleases(fetchFn: typeof fetch = fetch): Promise<Release[]> {
  const res = await fetchFn(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`releases ${res.status}`);
  return parseReleases(await res.json());
}
