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
| `migrations/` | De database (Cloudflare D1, SQLite). |

## Online zetten op Cloudflare

Je hebt een gratis Cloudflare-account en een Anthropic API-sleutel nodig (console.anthropic.com).

```bash
npm install
npx wrangler login

# 1. Database aanmaken. Zet de database_id die je terugkrijgt in wrangler.jsonc.
npx wrangler d1 create memefabriek

# 2. Geheimen instellen (je wordt om de waarde gevraagd).
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN     # lange willekeurige tekst, minstens 16 tekens: je wachtwoord voor /beheer
npx wrangler secret put IP_SALT         # nog een willekeurige tekst

# 3. Database vullen en de site online zetten.
npm run deploy
```

### memefabriek.nl koppelen

1. Voeg `memefabriek.nl` toe in het Cloudflare-dashboard (**Add a domain**) en zet bij je registrar de nameservers op de twee die Cloudflare je geeft.
2. Zet dit in `wrangler.jsonc` en draai `npm run deploy` opnieuw:
   ```jsonc
   "routes": [
     { "pattern": "memefabriek.nl", "custom_domain": true },
     { "pattern": "www.memefabriek.nl", "custom_domain": true }
   ]
   ```

### Spamcontrole (aanbevolen zodra de site druk wordt)

Maak in Cloudflare een **Turnstile**-widget voor memefabriek.nl en stel de sleutels in:

```bash
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
npm run db:local
npm run dev                      # http://localhost:8787
npm test
npm run typecheck
```

## Privacy

Er worden geen accounts, e-mailadressen of IP-adressen opgeslagen. Voor de limieten en meldingen bewaart de site een gehashte, gezouten versie van het IP-adres. De bijnaam, de geheime verwijdersleutel en welke memes van jou zijn, staan alleen in de browser van de bezoeker.
