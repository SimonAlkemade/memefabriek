# CLAUDE.md

Memefabriek (memefabriek.nl): a Cloudflare Worker with static assets and a D1
database. The README (Dutch) describes the product; this file is for agents.

## Commands

```bash
npm install
npm test            # vitest, pure modules
npm run typecheck
npm run dev         # local, http://localhost:8787 (needs .dev.vars, see .dev.vars.example)
```

## Deploying ("zet memefabriek online")

The owner wants the agent to deploy. The environment provides:

- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (wrangler reads both itself);
- `MEMEFABRIEK_ANTHROPIC_KEY`: the Anthropic key the SITE uses. Deliberately
  not named `ANTHROPIC_API_KEY`, so it never collides with the session's own.

Steps, in order. Stop and report if a step fails; never paste a secret value
into chat, a commit or a log.

1. `npm install && npm test && npm run typecheck`.
2. `npx wrangler deploy`. The first deploy auto-provisions the D1 database
   `memefabriek` (there is no `database_id` in `wrangler.jsonc` on purpose);
   the worker creates its tables on the first request (`src/schema.ts`).
   Note the `*.workers.dev` URL it prints.
3. Secrets (pipe values in, never echo them):
   - `printf %s "$MEMEFABRIEK_ANTHROPIC_KEY" | npx wrangler secret put ANTHROPIC_API_KEY`
   - `IP_SALT`: `openssl rand -hex 24 | npx wrangler secret put IP_SALT`
   - `ADMIN_TOKEN`: generate with `openssl rand -hex 16`, put it, and give it to
     the owner ONCE in the final reply (it is their password for `/beheer`).
     Do not store it in the repo.
4. Smoke test the live URL with curl: `GET /api/config` (expect
   `"claude":true`), post a meme to `/api/memes` with an `Origin` header equal
   to the site, reply to it, vote on it, `GET /api/feed`, `GET /m/<id>` (the
   og:title must carry the meme), then delete the test meme again through
   `POST /api/admin/memes/<id>` with `{"action":"delete"}` and the admin token.
5. Run the news desk once: `POST /api/admin/newsdesk` with the admin token.
   Report how many memes it made; if 0, check `GET /api/news` (are the NOS and
   NU.nl feeds reachable from Cloudflare?) and the Claude key.
6. Domain: only if `memefabriek.nl` is already a zone in the account
   (`npx wrangler` cannot add zones). Then add to `wrangler.jsonc`:
   `"routes": [{ "pattern": "memefabriek.nl", "custom_domain": true }, { "pattern": "www.memefabriek.nl", "custom_domain": true }]`,
   deploy again, commit and push. If the zone is not there, tell the owner to
   add it in the Cloudflare dashboard and change the nameservers at the registrar.

## Rules of the codebase

- Every visitor string is validated in `src/memes.ts` and rendered with
  `textContent` (`public/meme.js`). Keep it that way; the site is anonymous.
- `src/schema.ts` only ever grows: add tables, columns and indexes, never edit
  a shipped statement.
- Meme formats live in three places that must agree: `FORMATS` in
  `src/memes.ts`, `FORMATS` in `public/meme.js`, and `FORMAT_GUIDE` in
  `src/claude.ts`.
- The CSP in `public/_headers` forbids inline scripts and style attributes in
  markup; set styles from JS (`el.style.x = ...`) or in `style.css`.
