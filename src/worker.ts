// memefabriek.nl: the API under /api/* and the news desk on a cron. Everything
// else is a static file from public/, served by Cloudflare before this runs.

import { GenerateError, memeForHeadline, memesForStories, replyMeme } from "./claude";
import { parseHeadline, parseMeme, parseNickname, parseSource, type Meme } from "./memes";
import { fetchStories } from "./news";
import { ensureSchema } from "./schema";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  ADMIN_TOKEN?: string;
  ASSETS: Fetcher;
  IP_SALT?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  POSTS_PER_10_MIN?: string;
  GENERATIONS_PER_HOUR?: string;
  GENERATIONS_PER_DAY?: string;
  REPORTS_TO_HIDE?: string;
  NEWS_PER_RUN?: string;
}

const DESK = "nieuwsdesk";
const PAGE = 15;

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
const fail = (error: string, status = 400) => json({ error }, status);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function posterOf(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  return (await sha256((env.IP_SALT || "memefabriek-dev") + ip)).slice(0, 24);
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > 8_000) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function turnstileOk(env: Env, token: unknown, req: Request): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", req.headers.get("cf-connecting-ip") || "");
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    return Boolean(((await r.json()) as { success?: boolean }).success);
  } catch {
    return false;
  }
}

interface Row {
  id: string;
  parent_id: string | null;
  headline: string | null;
  source_host: string | null;
  source_url: string | null;
  format: string;
  scene: string;
  lines: string;
  nickname: string;
  poster: string;
  reports: number;
  hidden: number;
  score: number;
  created_at: string;
}

function view(r: Row) {
  return {
    id: r.id,
    headline: r.headline,
    source: r.source_url ? { host: r.source_host, url: r.source_url } : null,
    format: r.format,
    scene: r.scene,
    lines: JSON.parse(r.lines) as string[],
    nickname: r.nickname,
    desk: r.poster === DESK,
    score: r.score ?? 0,
    createdAt: r.created_at,
  };
}

async function getMeme(env: Env, id: string): Promise<Row | null> {
  return env.DB.prepare("SELECT * FROM memes WHERE id = ? AND hidden = 0").bind(id).first<Row>();
}

async function insertMeme(
  env: Env,
  m: Meme,
  fields: { parentId?: string | null; headline?: string | null; sourceHost?: string; sourceUrl?: string; nickname: string; poster: string; deleteKey?: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO memes (id, parent_id, headline, source_host, source_url, format, scene, lines, nickname, poster, delete_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      fields.parentId ?? null,
      fields.headline ?? null,
      fields.sourceHost || null,
      fields.sourceUrl || null,
      m.format,
      m.scene,
      JSON.stringify(m.lines),
      fields.nickname,
      fields.poster,
      fields.deleteKey ?? null,
      new Date().toISOString(),
    )
    .run();
  return id;
}

// ---------- routes ----------

const SORTS = {
  // Hot: the last two days by laughs, then everything older by laughs.
  hot: "ORDER BY (created_at > ?) DESC, score DESC, created_at DESC",
  new: "ORDER BY created_at DESC",
  // Top: only this week, by laughs.
  top: "AND created_at > ? ORDER BY score DESC, created_at DESC",
} as const;

/** Top-level memes with their replies (best first) and which of them this visitor laughed at. */
async function withReplies(env: Env, posts: Row[], voter: string) {
  const ids = posts.map((p) => p.id);
  if (!ids.length) return { memes: [], voted: [] as string[] };
  const marks = ids.map(() => "?").join(",");
  const replies = (
    await env.DB.prepare(`SELECT * FROM memes WHERE parent_id IN (${marks}) AND hidden = 0 ORDER BY score DESC, created_at ASC`)
      .bind(...ids)
      .all<Row>()
  ).results;
  const all = [...ids, ...replies.map((r) => r.id)];
  const voted: string[] = [];
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT meme_id FROM votes WHERE voter = ? AND meme_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(voter, ...chunk)
      .all<{ meme_id: string }>();
    voted.push(...results.map((r) => r.meme_id));
  }
  const byParent = new Map<string, ReturnType<typeof view>[]>();
  for (const r of replies) {
    const list = byParent.get(r.parent_id!) ?? [];
    list.push(view(r));
    byParent.set(r.parent_id!, list);
  }
  return { memes: posts.map((p) => ({ ...view(p), replies: byParent.get(p.id) ?? [] })), voted };
}

async function feed(req: Request, url: URL, env: Env): Promise<Response> {
  const sort = (Object.hasOwn(SORTS, url.searchParams.get("sort") ?? "") ? url.searchParams.get("sort") : "hot") as keyof typeof SORTS;
  const page = Math.min(Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0)), 200);
  const binds: unknown[] = sort === "hot" ? [minutesAgo(48 * 60)] : sort === "top" ? [minutesAgo(7 * 24 * 60)] : [];
  const { results: posts } = await env.DB.prepare(`SELECT * FROM memes WHERE parent_id IS NULL AND hidden = 0 ${SORTS[sort]} LIMIT ? OFFSET ?`)
    .bind(...binds, PAGE, page * PAGE)
    .all<Row>();
  const out = await withReplies(env, posts, await posterOf(req, env));
  return json({ ...out, next: posts.length === PAGE ? page + 1 : null });
}

async function single(req: Request, env: Env, id: string): Promise<Response> {
  const row = await getMeme(env, id);
  if (!row) return fail("Deze meme bestaat niet (meer).", 404);
  const root = row.parent_id ? await getMeme(env, row.parent_id) : row;
  if (!root) return fail("Deze meme bestaat niet (meer).", 404);
  const out = await withReplies(env, [root], await posterOf(req, env));
  return json({ meme: out.memes[0], voted: out.voted, focus: row.id });
}

async function vote(req: Request, env: Env, id: string): Promise<Response> {
  const voter = await posterOf(req, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE voter = ? AND created_at > ?")
    .bind(voter, minutesAgo(10))
    .first<{ n: number }>();
  const had = await env.DB.prepare("SELECT 1 FROM votes WHERE meme_id = ? AND voter = ?").bind(id, voter).first();
  if (had) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM votes WHERE meme_id = ? AND voter = ?").bind(id, voter),
      env.DB.prepare("UPDATE memes SET score = MAX(0, score - 1) WHERE id = ?").bind(id),
    ]);
  } else {
    if ((recent?.n ?? 0) >= 120) return fail("Je lacht wel heel veel. Probeer het over een paar minuten weer.", 429);
    if (!(await getMeme(env, id))) return fail("Deze meme bestaat niet meer.", 404);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO votes (meme_id, voter, created_at) VALUES (?, ?, ?)").bind(id, voter, new Date().toISOString()),
      env.DB.prepare("UPDATE memes SET score = (SELECT COUNT(*) FROM votes WHERE meme_id = ?) WHERE id = ?").bind(id, id),
    ]);
  }
  const row = await env.DB.prepare("SELECT score FROM memes WHERE id = ?").bind(id).first<{ score: number }>();
  return json({ voted: !had, score: row?.score ?? 0 });
}

async function leaders(env: Env): Promise<Response> {
  // Bare nickname next to MAX(created_at) is SQLite's way of taking it from that newest row.
  const { results } = await env.DB.prepare(
    `SELECT nickname, MAX(created_at) AS last, SUM(score) AS laughs, COUNT(*) AS memes
     FROM memes WHERE hidden = 0 AND poster != ? AND created_at > ?
     GROUP BY poster HAVING laughs > 0 ORDER BY laughs DESC, memes DESC LIMIT 10`,
  )
    .bind(DESK, minutesAgo(7 * 24 * 60))
    .all<{ nickname: string; laughs: number; memes: number }>();
  return json({ leaders: results.map((r) => ({ nickname: r.nickname, laughs: r.laughs, memes: r.memes })) });
}

async function news(): Promise<Response> {
  const cache = caches.default;
  const key = new Request("https://memefabriek.internal/news-v1");
  const hit = await cache.match(key);
  if (hit) return hit;
  const stories = (await fetchStories(12)).map((s) => ({ title: s.title, url: s.link, host: new URL(s.link).hostname.replace(/^www\./, "") }));
  const res = json({ stories });
  if (stories.length) {
    const cached = new Response(res.clone().body, res);
    cached.headers.set("cache-control", "public, max-age=600");
    await cache.put(key, cached);
  }
  return res;
}

/** /m/<id>: the normal page, with the meme's own title and preview for WhatsApp, X and friends. */
async function memePage(req: Request, env: Env, id: string): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL("/", req.url)));
  const row = await getMeme(env, id);
  if (!row) return page;
  const root = row.parent_id ? await getMeme(env, row.parent_id) : row;
  const lines = (JSON.parse(row.lines) as string[]).filter(Boolean).join(" / ");
  const title = `${lines.slice(0, 90)} | Memefabriek`;
  const desc = `Meme over: ${root?.headline ?? "het nieuws"}. Reageer met een meme op memefabriek.nl.`;
  const url = new URL(`/m/${id}`, req.url).href;
  const set = (content: string) => ({ element: (e: Element) => { e.setAttribute("content", content); } });
  return new HTMLRewriter()
    .on("title", { element: (e) => { e.setInnerContent(title); } })
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[name="description"]', set(desc))
    .on('meta[property="og:url"]', set(url))
    .transform(page);
}

async function tooManyPosts(env: Env, poster: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM memes WHERE poster = ? AND created_at > ?")
    .bind(poster, minutesAgo(10))
    .first<{ n: number }>();
  return (row?.n ?? 0) >= num(env.POSTS_PER_10_MIN, 6);
}

async function post(req: Request, env: Env, parentId: string | null): Promise<Response> {
  const body = await readBody(req);
  if (!body) return fail("Dit verzoek kon niet worden gelezen.");
  const meme = parseMeme(body);
  if (!meme.ok) return fail(meme.error);
  const nick = parseNickname(body.nickname);
  if (!nick.ok) return fail(nick.error);
  let headline: string | null = null;
  let source = { url: "", host: "" };
  if (parentId) {
    if (!(await getMeme(env, parentId))) return fail("Deze meme bestaat niet meer.", 404);
  } else {
    const h = parseHeadline(body.headline);
    if (!h.ok) return fail(h.error);
    const s = parseSource(body.sourceUrl);
    if (!s.ok) return fail(s.error);
    headline = h.value;
    source = s.value;
  }
  if (!(await turnstileOk(env, body.turnstileToken, req))) return fail("De controle of je een mens bent is mislukt. Probeer het opnieuw.", 403);
  const poster = await posterOf(req, env);
  if (await tooManyPosts(env, poster)) return fail("Rustig aan: je hebt net veel gepost. Probeer het over een paar minuten weer.", 429);
  const deleteKey = typeof body.deleteKey === "string" && body.deleteKey.length >= 16 ? await sha256(body.deleteKey) : null;
  const id = await insertMeme(env, meme.value, {
    parentId,
    headline,
    sourceHost: source.host,
    sourceUrl: source.url,
    nickname: nick.value,
    poster,
    deleteKey,
  });
  return json({ id }, 201);
}

async function removeOwn(req: Request, env: Env, id: string): Promise<Response> {
  const body = await readBody(req);
  const key = body && typeof body.deleteKey === "string" ? await sha256(body.deleteKey) : "";
  const res = await env.DB.prepare("DELETE FROM memes WHERE id = ? AND delete_key IS NOT NULL AND delete_key = ?").bind(id, key).run();
  return res.meta.changes ? json({ ok: true }) : fail("Je kunt alleen je eigen memes verwijderen.", 403);
}

async function report(req: Request, env: Env, id: string): Promise<Response> {
  const poster = await posterOf(req, env);
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO reports (meme_id, reporter, created_at) SELECT id, ?, ? FROM memes WHERE id = ?")
    .bind(poster, new Date().toISOString(), id)
    .run();
  if (ins.meta.changes) {
    await env.DB.prepare("UPDATE memes SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?")
      .bind(num(env.REPORTS_TO_HIDE, 3), id)
      .run();
  }
  return json({ ok: true });
}

async function generate(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  if (!body) return fail("Dit verzoek kon niet worden gelezen.");
  if (!env.ANTHROPIC_API_KEY) return fail("Claude is nog niet ingesteld op deze site.", 503);
  const poster = await posterOf(req, env);
  const [mine, all] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM generations WHERE poster = ? AND created_at > ?").bind(poster, minutesAgo(60)).first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM generations WHERE created_at > ?").bind(minutesAgo(24 * 60)).first<{ n: number }>(),
  ]);
  if ((mine?.n ?? 0) >= num(env.GENERATIONS_PER_HOUR, 15)) return fail("Je hebt Claude dit uur vaak genoeg laten schrijven. Schrijf deze zelf, of probeer het later.", 429);
  if ((all?.n ?? 0) >= num(env.GENERATIONS_PER_DAY, 400)) return fail("Claude heeft vandaag al genoeg memes geschreven. Schrijf deze zelf, of kom morgen terug.", 429);

  let task: () => Promise<Meme>;
  if (typeof body.replyTo === "string") {
    const parent = await getMeme(env, body.replyTo);
    if (!parent) return fail("Deze meme bestaat niet meer.", 404);
    const original = parseMeme({ ...view(parent) });
    if (!original.ok) return fail("Op deze meme kan Claude niet reageren.");
    const root = parent.parent_id ? await getMeme(env, parent.parent_id) : parent;
    task = () => replyMeme(env, root?.headline || "", original.value);
  } else {
    const h = parseHeadline(body.headline);
    if (!h.ok) return fail(h.error);
    task = () => memeForHeadline(env, h.value);
  }
  await env.DB.prepare("INSERT INTO generations (poster, created_at) VALUES (?, ?)").bind(poster, new Date().toISOString()).run();
  try {
    return json({ meme: await task() });
  } catch (e) {
    if (e instanceof GenerateError) return fail(e.message, 422);
    throw e;
  }
}

// ---------- moderation ----------

function isAdmin(req: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || token.length < 16 || got.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function adminQueue(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM memes WHERE reports > 0 OR hidden = 1 ORDER BY hidden DESC, reports DESC, created_at DESC LIMIT 100",
  ).all<Row>();
  return json({ memes: results.map((r) => ({ ...view(r), reports: r.reports, hidden: Boolean(r.hidden), isReply: Boolean(r.parent_id) })) });
}

async function adminAct(req: Request, env: Env, id: string): Promise<Response> {
  const body = await readBody(req);
  const action = body?.action;
  if (action === "hide") await env.DB.prepare("UPDATE memes SET hidden = 1 WHERE id = ?").bind(id).run();
  else if (action === "show") await env.DB.prepare("UPDATE memes SET hidden = 0, reports = 0 WHERE id = ?").bind(id).run();
  else if (action === "delete") await env.DB.prepare("DELETE FROM memes WHERE id = ?").bind(id).run();
  else return fail("Onbekende actie.");
  if (action === "show") await env.DB.prepare("DELETE FROM reports WHERE meme_id = ?").bind(id).run();
  return json({ ok: true });
}

// ---------- news desk ----------

export async function runNewsDesk(env: Env): Promise<number> {
  const stories = await fetchStories(30);
  if (!stories.length) return 0;
  const seen = new Set(
    (
      await env.DB.prepare(`SELECT link FROM news_seen WHERE link IN (${stories.map(() => "?").join(",")})`)
        .bind(...stories.map((s) => s.link))
        .all<{ link: string }>()
    ).results.map((r) => r.link),
  );
  const fresh = stories.filter((s) => !seen.has(s.link)).slice(0, 15);
  if (!fresh.length) return 0;
  const made = await memesForStories(env, fresh, num(env.NEWS_PER_RUN, 3));
  const now = new Date().toISOString();
  await env.DB.batch(fresh.map((s) => env.DB.prepare("INSERT OR IGNORE INTO news_seen (link, created_at) VALUES (?, ?)").bind(s.link, now)));
  for (const { story, meme } of made) {
    await insertMeme(env, meme, {
      headline: story.title.slice(0, 200),
      sourceHost: new URL(story.link).hostname.replace(/^www\./, ""),
      sourceUrl: story.link,
      nickname: "Nieuwsdesk",
      poster: DESK,
    });
  }
  return made.length;
}

// ---------- entry ----------

const ROUTE_ID = "([0-9a-f-]{36})";

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = (re: string) => path.match(new RegExp(`^${re}$`));

  let g;
  if (req.method === "GET" && path === "/api/feed") return feed(req, url, env);
  if (req.method === "GET" && path === "/api/news") return news();
  if (req.method === "GET" && path === "/api/leaders") return leaders(env);
  if (req.method === "GET" && (g = m(`/api/memes/${ROUTE_ID}`))) return single(req, env, g[1]);
  if (req.method === "GET" && (g = m(`/m/${ROUTE_ID}`))) return memePage(req, env, g[1]);
  if (req.method === "GET" && path === "/api/config")
    return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null, claude: Boolean(env.ANTHROPIC_API_KEY) });

  if (path.startsWith("/api/admin/")) {
    if (!isAdmin(req, env)) return fail("Geen toegang.", 401);
    if (req.method === "GET" && path === "/api/admin/queue") return adminQueue(env);
    let a;
    if (req.method === "POST" && (a = m(`/api/admin/memes/${ROUTE_ID}`))) return adminAct(req, env, a[1]);
    if (req.method === "POST" && path === "/api/admin/newsdesk") return json({ made: await runNewsDesk(env) });
    return fail("Niet gevonden.", 404);
  }

  if (req.method === "POST") {
    // Only this site's own pages may post, so other sites cannot spend visitors' limits.
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("Niet toegestaan.", 403);
    let a;
    if (path === "/api/memes") return post(req, env, null);
    if ((a = m(`/api/memes/${ROUTE_ID}/replies`))) return post(req, env, a[1]);
    if ((a = m(`/api/memes/${ROUTE_ID}/delete`))) return removeOwn(req, env, a[1]);
    if ((a = m(`/api/memes/${ROUTE_ID}/report`))) return report(req, env, a[1]);
    if ((a = m(`/api/memes/${ROUTE_ID}/vote`))) return vote(req, env, a[1]);
    if (path === "/api/generate") return generate(req, env);
  }
  return fail("Niet gevonden.", 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      await ensureSchema(env.DB);
      return await handle(req, env);
    } catch (e) {
      console.error(e);
      return fail("Er ging iets mis aan onze kant. Probeer het zo opnieuw.", 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runNewsDesk(env)).then((n) => console.log(`news desk: ${n} memes`)));
  },
} satisfies ExportedHandler<Env>;
