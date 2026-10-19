// Validation for everything a visitor or Claude sends in. The browser renders
// with the same rules (public/app.js), but only this file is trusted.

export const FORMATS = {
  impact: 2, // boven- en ondertekst over een plaatje
  drake: 2, // nee / ja
  brain: 4, // groeiend brein
  nobody: 2, // "Niemand: / Ik: ..."
  expect: 2, // verwachting / werkelijkheid
  buttons: 3, // twee knoppen: [knop links, knop rechts, wie twijfelt]
  mind: 1, // "Verander mijn mening": [stelling]
} as const;
export type Format = keyof typeof FORMATS;

export const SCENES = ["fire", "stonks", "rain", "spotlight", "space"] as const;
export type Scene = (typeof SCENES)[number];

export const MAX_LINE = 120;
export const MAX_HEADLINE = 200;
export const MAX_NICK = 30;

export interface Meme {
  format: Format;
  scene: Scene;
  lines: string[];
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const clean = (s: unknown) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim() : "";

export function isFormat(f: unknown): f is Format {
  return typeof f === "string" && Object.hasOwn(FORMATS, f);
}

export function parseMeme(input: unknown): Result<Meme> {
  const m = (input ?? {}) as Record<string, unknown>;
  if (!isFormat(m.format)) return { ok: false, error: "Kies een geldig memeformaat." };
  const scene = SCENES.includes(m.scene as Scene) ? (m.scene as Scene) : "spotlight";
  if (!Array.isArray(m.lines)) return { ok: false, error: "De meme heeft geen tekst." };
  const n = FORMATS[m.format];
  const lines = Array.from({ length: n }, (_, i) => clean(m.lines && (m.lines as unknown[])[i]));
  if (lines.some((l) => l.length > MAX_LINE)) return { ok: false, error: `Een regel mag maximaal ${MAX_LINE} tekens hebben.` };
  if (!lines.some(Boolean)) return { ok: false, error: "Schrijf minstens één regel." };
  return { ok: true, value: { format: m.format, scene, lines } };
}

export function parseNickname(input: unknown): Result<string> {
  const nick = clean(input);
  if (!nick) return { ok: false, error: "Kies een bijnaam." };
  if (nick.length > MAX_NICK) return { ok: false, error: `Je bijnaam mag maximaal ${MAX_NICK} tekens hebben.` };
  if (/^nieuwsdesk$/i.test(nick)) return { ok: false, error: "Die bijnaam is gereserveerd." };
  return { ok: true, value: nick };
}

export function parseHeadline(input: unknown): Result<string> {
  const h = clean(input);
  if (!h) return { ok: false, error: "Elke meme hoort bij een nieuwskop. Vul de kop in." };
  if (h.length > MAX_HEADLINE) return { ok: false, error: `De kop mag maximaal ${MAX_HEADLINE} tekens hebben.` };
  return { ok: true, value: h };
}

/** An optional https link to the story. Returns the link and its host, or empty strings. */
export function parseSource(input: unknown): Result<{ url: string; host: string }> {
  const raw = clean(input);
  if (!raw) return { ok: true, value: { url: "", host: "" } };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "De bronlink is geen geldige link." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "De bronlink moet met https:// beginnen." };
  if (u.href.length > 500) return { ok: false, error: "De bronlink is te lang." };
  return { ok: true, value: { url: u.href, host: u.hostname.replace(/^www\./, "") } };
}
