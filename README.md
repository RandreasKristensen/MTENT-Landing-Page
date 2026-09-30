# gitster: pretotype

A fake-door test for **gitster**, an online DAW for making songs with other people.
It's a static site on Cloudflare Pages with two Pages Functions and a D1 database.
There's no framework and no build step.

| Route      | What it is |
|------------|------------|
| `/`        | Interactive demo: a scripted, simulated collaborative DAW (Web Audio, no audio files) |
| `/signup`  | The landing page with the early-access form |
| `/api/signup` | `POST` a signup and store it in D1 |
| `/api/event`  | `POST` a funnel event and store it in D1 (only known event names are stored) |

```
index.html              design source of truth (input only, NOT deployed)
public/                 everything that gets deployed
  index.html            demo  (/)
  signup/index.html     landing page (/signup)
  assets/gitster.css    shared design system
  assets/demo.js        demo: audio engine, steps, collaborator, version rings, autoplay
  assets/funnel.js      src carry-over, per-visit session id, sendBeacon events
functions/api/          Pages Functions
schema.sql              D1 tables
queries/                funnel / drop-off / export SQL used below
wrangler.toml
```

Every internal link to `/signup` (and back to `/`) carries the `?src=` of the visit,
e.g. `/?src=rehearsal-room` → `/signup?src=rehearsal-room`. The session id lives in
`sessionStorage`, so the same visit keeps one id from `/` to `/signup`.

All commands run from the repo root. `npx wrangler` works without a global install.

---

## 1. Create the D1 database and apply the schema

```sh
npx wrangler login
npx wrangler d1 create gitster
```

Copy the `database_id` it prints into `wrangler.toml` (replace the zeros). Then:

```sh
npx wrangler d1 execute gitster --remote --file=./schema.sql
```

## 2. Deploy

```sh
npx wrangler pages project create gitster --production-branch main
npx wrangler pages deploy public
```

The first deploy prints the `*.pages.dev` URL.

### Bind D1 in the dashboard

`wrangler.toml` already declares the `DB` binding, and `wrangler pages deploy` applies it.
To check or set it by hand:

1. Cloudflare dashboard → **Workers & Pages** → **gitster** → **Settings** → **Bindings**
2. **Add** → **D1 database** → Variable name `DB` → Database `gitster` → **Save**
3. Redeploy (`npx wrangler pages deploy public`) so the binding takes effect.

> While `wrangler.toml` contains `pages_build_output_dir`, the dashboard treats that
> file as the source of truth for bindings, and they show as read-only there. If you'd
> rather manage the binding only in the dashboard, delete the `[[d1_databases]]` block
> from `wrangler.toml` first. For local dev without it, use
> `npx wrangler pages dev public --d1 DB=<database_id>`.

## 3. Turn on Cloudflare Web Analytics

Cloudflare dashboard → **Workers & Pages** → **gitster** → **Metrics** →
**Web Analytics** → **Enable**. Then redeploy:

```sh
npx wrangler pages deploy public
```

Cloudflare injects its cookieless beacon on the next deploy. You don't need to add a
snippet to the HTML. The numbers appear under **Analytics & Logs → Web Analytics**.

---

## Test locally

```sh
npx wrangler d1 execute gitster --local --file=./schema.sql
npx wrangler pages dev public
```

Open <http://localhost:8788/?src=local-test>, go through the demo, sign up, then:

```sh
npx wrangler d1 execute gitster --local --command "SELECT * FROM signups"
```

`--local` and `--remote` are the only difference between local and production for
every query below.

---

## Funnel per `src`

`demo_view → demo_step_5 → signup_click → signup_view → signups`, as one query.
Event columns count distinct sessions. `signups` counts rows in `signups`.
The SQL is in [`queries/funnel.sql`](queries/funnel.sql).

```sql
WITH e AS (
  SELECT COALESCE(src, '(none)') AS src,
    COUNT(DISTINCT CASE WHEN name = 'demo_view'    THEN session_id END) AS demo_view,
    COUNT(DISTINCT CASE WHEN name = 'demo_step_5'  THEN session_id END) AS demo_step_5,
    COUNT(DISTINCT CASE WHEN name = 'signup_click' THEN session_id END) AS signup_click,
    COUNT(DISTINCT CASE WHEN name = 'signup_view'  THEN session_id END) AS signup_view
  FROM events GROUP BY 1
),
s AS (SELECT COALESCE(src, '(none)') AS src, COUNT(*) AS signups FROM signups GROUP BY 1),
k AS (SELECT src FROM e UNION SELECT src FROM s)
SELECT k.src,
  COALESCE(e.demo_view, 0)    AS demo_view,
  COALESCE(e.demo_step_5, 0)  AS demo_step_5,
  COALESCE(e.signup_click, 0) AS signup_click,
  COALESCE(e.signup_view, 0)  AS signup_view,
  COALESCE(s.signups, 0)      AS signups,
  ROUND(100.0 * COALESCE(s.signups, 0) / NULLIF(e.demo_view, 0), 1) AS pct_view_to_signup
FROM k LEFT JOIN e ON e.src = k.src LEFT JOIN s ON s.src = k.src
ORDER BY demo_view DESC, signups DESC;
```

Run it:

```sh
# bash / zsh / Git Bash
npx wrangler d1 execute gitster --remote --command "$(cat queries/funnel.sql)"
```
```powershell
# PowerShell
npx wrangler d1 execute gitster --remote --command (Get-Content queries/funnel.sql -Raw)
```

## Where people drop off in the demo

For each step, this shows how many sessions reached it, the share of `demo_view`
sessions that is, and how many sessions stopped there (furthest step reached, no
`signup_click`). The SQL is in [`queries/dropoff.sql`](queries/dropoff.sql).

```sh
npx wrangler d1 execute gitster --remote --command "$(cat queries/dropoff.sql)"
```
```powershell
npx wrangler d1 execute gitster --remote --command (Get-Content queries/dropoff.sql -Raw)
```

## Export signups as CSV

```powershell
# PowerShell
(npx wrangler d1 execute gitster --remote --json --command "SELECT id, email, daw, pain, src, consent, created_at FROM signups ORDER BY created_at" | Out-String | ConvertFrom-Json)[0].results | Export-Csv signups.csv -NoTypeInformation -Encoding UTF8
```
```sh
# bash / zsh (needs jq)
npx wrangler d1 execute gitster --remote --json \
  --command "SELECT id, email, daw, pain, src, consent, created_at FROM signups ORDER BY created_at" \
  | jq -r '.[0].results | (.[0] | keys_unsorted) as $k | ($k | @csv), (.[] | [.[$k[]]] | @csv)' > signups.csv
```

`*.csv` is gitignored. Signups are personal data, so don't commit them.

---

## Events

Sent with `navigator.sendBeacon` to `/api/event` as `{ name, src, session_id }`.

| Page | Events |
|------|--------|
| `/` | `demo_view`, `demo_step_1` … `demo_step_5`, `demo_autoplay`, `demo_audio_play`, `demo_knob_turn` (once per visit), `demo_version_restore`, `signup_click` |
| `/signup` | `signup_view`, `ring_click` (once per visit), `signup_submit_error` |

`demo_step_1` fires when the shared project is opened, not on page load.
`demo_step_2` through `demo_step_5` fire the first time each step is shown per page load.
`signup_submit_error` fires on client validation errors and on failed saves.

## Data and privacy

- `signups`: email (unique, lowercased), DAW, pain (max 500 chars), src, consent, created_at.
- `events`: name, src, random session id, created_at.
- No IP addresses, user agents or cookies are stored. The session id is random and is
  never linked to an email.
- Signup form: consent is required, and a filled honeypot field returns success
  without storing anything. A duplicate email returns success without adding a row.
