// Pulls headlines from Dutch RSS feeds. Parsing is deliberately small: RSS 2.0
// <item>s with a <title> and <link> are all the feeds below use.

export const FEEDS = [
  "https://feeds.nos.nl/nosnieuwsalgemeen",
  "https://www.nu.nl/rss/Algemeen",
];

export interface Story {
  title: string;
  link: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRss(xml: string): Story[] {
  const out: Story[] = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = decode(item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const link = decode(item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    if (title && /^https:\/\//.test(link)) out.push({ title, link });
  }
  return out;
}

/** Interleave the feeds so one source never fills the whole batch. */
export function interleave(lists: Story[][], limit: number): Story[] {
  const out: Story[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const s = l[i];
      if (s && !seen.has(s.link) && out.length < limit) {
        seen.add(s.link);
        out.push(s);
      }
    }
  }
  return out;
}

export async function fetchStories(limit: number): Promise<Story[]> {
  const lists = await Promise.all(
    FEEDS.map(async (url) => {
      try {
        const res = await fetch(url, { headers: { "user-agent": "memefabriek.nl news desk" } });
        return res.ok ? parseRss(await res.text()) : [];
      } catch {
        return [];
      }
    }),
  );
  return interleave(lists, limit);
}
