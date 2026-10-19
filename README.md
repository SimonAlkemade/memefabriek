# Memefabriek

De code achter **memefabriek.nl**: memes van het laatste nieuws, en iedereen kan op elke meme reageren met een meme.

- Iedereen kan zonder account een meme posten of reageren, met een zelfgekozen bijnaam.
- De **Nieuwsdesk** leest vier keer per dag NOS en NU.nl en laat Claude er memes van maken. Pijnlijk nieuws (doden, oorlog, rampen) slaat hij over.
- Bezoekers kunnen Claude een meme laten schrijven bij een kop die ze zelf plakken, of een reactie op een andere meme.
- Een meme met 3 meldingen verdwijnt vanzelf. Via `/beheer` zet je hem terug of verwijder je hem.

## Hoe het in elkaar zit

| Onderdeel | Wat |
|---|---|
| `public/` | De website zelf (HTML, CSS, JS). Wordt rechtstreeks door Cloudflare geserveerd. |
| `src/worker.ts` | De API onder `/api/*` en de Nieuwsdesk (cron). |
| `src/claude.ts` | De opdrachten aan Claude. Elk antwoord wordt gecontroleerd voordat het op de site komt. |
| `src/memes.ts` | Controle van alles wat een bezoeker instuurt. |
| `src/news.ts` | Het ophalen van de RSS-feeds van NOS en NU.nl. |
| `src/schema.ts` | De database (Cloudflare D1, SQLite). Richt zichzelf in bij de eerste aanvraag. |

## Online zetten op Cloudflare (zonder terminal)

Je hebt een gratis Cloudflare-account nodig en een Anthropic API-sleutel (console.anthropic.com). De database wordt bij de eerste deploy vanzelf aangemaakt en ingericht.

1. **Koppel de repo.** Cloudflare-dashboard → **Workers & Pages** → **Create** → **Import a repository** → kies GitHub en deze repo. Laat de voorgestelde instellingen staan (deploy-commando `npx wrangler deploy`) en klik **Deploy**. De site staat dan op `memefabriek.<jouw-naam>.workers.dev`.
2. **Stel de geheimen in.** Open de Worker **memefabriek** → **Settings** → **Variables and Secrets** → **Add**, type **Secret**:
   - `ANTHROPIC_API_KEY`: je Anthropic API-sleutel.
   - `ADMIN_TOKEN`: een lange willekeurige tekst (minstens 16 tekens). Dit is je wachtwoord voor `/beheer`.
   - `IP_SALT`: nog een willekeurige tekst.
3. **Koppel memefabriek.nl.** Dashboard → **Add a domain** → `memefabriek.nl`, en zet bij je registrar de nameservers op de twee die Cloudflare geeft. Is het domein actief, ga dan naar de Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `memefabriek.nl` (en eventueel `www.memefabriek.nl`).

Elke push naar `main` zet daarna automatisch de nieuwe versie online.

### Met de terminal

```bash
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put IP_SALT
npm run deploy
```

### Spamcontrole (aanbevolen zodra de site druk wordt)

Maak in Cloudflare een **Turnstile**-widget voor memefabriek.nl en stel de sleutels in:

```bash
# of in het dashboard bij Variables and Secrets
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET
```

Bezoekers krijgen dan alleen bij twijfel een korte controle voordat ze posten.

## Kosten en limieten

Cloudflare is gratis tot ruim 100.000 bezoeken per dag. Claude kost geld per meme die het schrijft; de limieten staan in `wrangler.jsonc` onder `vars`:

| Instelling | Standaard | Betekenis |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5-5` | Het model dat de grappen schrijft. `claude-haiku-5-5` is veel goedkoper, maar minder grappig. |
| `GENERATIONS_PER_DAY` | 400 | Maximaal aantal Claude-memes per dag voor de hele site (Nieuwsdesk niet meegeteld). |
| `GENERATIONS_PER_HOUR` | 15 | Per bezoeker per uur. |
| `POSTS_PER_10_MIN` | 6 | Posts per bezoeker per 10 minuten. |
| `REPORTS_TO_HIDE` | 3 | Meldingen voordat een meme verdwijnt. |
| `NEWS_PER_RUN` | 3 | Memes per Nieuwsdesk-ronde (vier rondes per dag). |

Stel daarnaast in de Anthropic Console een maandlimiet in, zodat de rekening nooit verrast.

## Lokaal ontwikkelen

```bash
cp .dev.vars.example .dev.vars   # en vul in
npm run dev                      # http://localhost:8787
npm test
npm run typecheck
```

## Privacy

Er worden geen accounts, e-mailadressen of IP-adressen opgeslagen. Voor de limieten en meldingen bewaart de site een gehashte, gezouten versie van het IP-adres. De bijnaam, de geheime verwijdersleutel en welke memes van jou zijn, staan alleen in de browser van de bezoeker.
