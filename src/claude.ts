// Claude writes the jokes. Every answer goes through parseMeme before it is
// shown or stored, exactly like a visitor's own meme.

import Anthropic from "@anthropic-ai/sdk";
import { FORMATS, SCENES, parseMeme, type Meme } from "./memes";
import type { Story } from "./news";

export class GenerateError extends Error {}

const FORMAT_GUIDE = `Formaten (kies het formaat waarin de grap het best landt):
- "impact": klassieke boven- en ondertekst over een plaatje. lines: [boven, onder]. Kies een "scene".
- "drake": één ding afwijzen, iets anders omarmen. lines: [afgewezen, omarmd].
- "brain": groeiend brein, vier steeds absurdere stappen. lines: [1, 2, 3, 4].
- "nobody": "Niemand: / Helemaal niemand: / X: doet Y". lines: [wie X is, wat X doet].
- "expect": verwachting tegenover werkelijkheid. lines: [verwachting, werkelijkheid]. "scene" is het werkelijkheid-plaatje.
Scenes: "fire" (kamer in brand, "this is fine"), "stonks" (rode grafiek die crasht), "rain" (sombere regenwolk), "spotlight" (triomfantelijk podium), "space" (kosmisch).`;

const RULES = `Regels:
- Schrijf in het Nederlands, in de toon van Nederlandse internethumor: droog, scherp, herkenbaar.
- Maak het grappig en specifiek voor dit nieuws. Trap naar boven: machthebbers, bedrijven, absurde situaties.
- Maak nooit grappen over mensen die zijn overleden, gewond zijn of slachtoffer zijn, en niet over oorlog, aanslagen, rampen of misdrijven met slachtoffers. Is het nieuws zo'n verhaal, zet dan "ok" op false en leg in "reason" in één korte zin uit waarom.
- Elke regel korter dan 80 tekens. Geen hashtags, geen emoji.`;

const MEME_PROPS = {
  format: { type: "string", enum: Object.keys(FORMATS) },
  scene: { type: "string", enum: [...SCENES] },
  lines: { type: "array", items: { type: "string" } },
};

const ONE_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" }, reason: { type: "string" }, ...MEME_PROPS },
  required: ["ok", "reason", "format", "scene", "lines"],
  additionalProperties: false,
};

const BATCH_SCHEMA = {
  type: "object",
  properties: {
    memes: {
      type: "array",
      items: {
        type: "object",
        properties: { story: { type: "integer" }, ...MEME_PROPS },
        required: ["story", "format", "scene", "lines"],
        additionalProperties: false,
      },
    },
  },
  required: ["memes"],
  additionalProperties: false,
};

interface Env {
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
}

async function ask(env: Env, prompt: string, schema: object, maxTokens: number): Promise<unknown> {
  if (!env.ANTHROPIC_API_KEY) throw new GenerateError("Claude is nog niet ingesteld op deze site.");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new GenerateError("Claude heeft het even te druk. Probeer het over een minuut opnieuw.");
    console.error("claude error", e);
    throw new GenerateError("Claude reageert nu niet. Probeer het zo opnieuw of schrijf de meme zelf.");
  }
  if (res.stop_reason === "refusal") throw new GenerateError("Claude slaat dit nieuws over. Kies een ander verhaal.");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new GenerateError("Claude gaf een onbruikbaar antwoord. Probeer het opnieuw.");
  }
}

function one(out: unknown): Meme {
  const o = out as { ok?: boolean; reason?: string };
  if (!o || o.ok === false) throw new GenerateError("Claude slaat dit nieuws over: " + String(o?.reason || "geen geschikt onderwerp").slice(0, 200));
  const m = parseMeme(out);
  if (!m.ok) throw new GenerateError("Claude gaf een onbruikbare meme. Probeer het opnieuw.");
  return m.value;
}

export async function memeForHeadline(env: Env, headline: string): Promise<Meme> {
  return one(
    await ask(
      env,
      `Je maakt memes over nieuwskoppen voor memefabriek.nl.\nNieuwskop: ${JSON.stringify(headline)}\n\n${FORMAT_GUIDE}\n\n${RULES}`,
      ONE_SCHEMA,
      4000,
    ),
  );
}

export async function replyMeme(env: Env, headline: string, original: Meme): Promise<Meme> {
  return one(
    await ask(
      env,
      `Op memefabriek.nl gaat elke meme over een nieuwsbericht, en bezoekers reageren op memes met memes.
Nieuwskop: ${JSON.stringify(headline)}
De meme waarop gereageerd wordt heeft formaat "${original.format}" en de regels ${JSON.stringify(original.lines)}.
Maak één reactie-meme die erop voortborduurt: een weerwoord, een overtreffende trap of een onverwachte draai. Een ander formaat mag als dat beter werkt.

${FORMAT_GUIDE}

${RULES}`,
      ONE_SCHEMA,
      4000,
    ),
  );
}

/** For the news desk: Claude picks the stories that can carry a joke and skips the rest. */
export async function memesForStories(env: Env, stories: Story[], count: number): Promise<{ story: Story; meme: Meme }[]> {
  const list = stories.map((s, i) => `${i}. ${s.title}`).join("\n");
  const out = (await ask(
    env,
    `Je bent de nieuwsdesk van memefabriek.nl. Hieronder staan de laatste Nederlandse nieuwskoppen, genummerd.
${list}

Kies maximaal ${count} koppen die zich lenen voor een goede, onschuldige grap, en maak voor elk één meme. Geef bij "story" het nummer van de kop. Sla elk verhaal over waarbij de regels hieronder een grap verbieden; liever minder memes dan een pijnlijke.

${FORMAT_GUIDE}

${RULES}`,
    BATCH_SCHEMA,
    8000,
  )) as { memes?: unknown[] };
  const result: { story: Story; meme: Meme }[] = [];
  const used = new Set<number>();
  for (const item of out?.memes ?? []) {
    const idx = Number((item as { story?: unknown }).story);
    const m = parseMeme(item);
    if (!m.ok || !stories[idx] || used.has(idx)) continue;
    used.add(idx);
    result.push({ story: stories[idx], meme: m.value });
    if (result.length >= count) break;
  }
  return result;
}
