# dota-team-drafts

Drafts and match lineups for **De 4 clownerna och Poppe**.

[Open the library](https://maakep.github.io/dota-team-drafts/)

## Run locally

Node.js 22 or newer. No dependencies to install.

```sh
npm run dev      # http://127.0.0.1:4173; reload after source changes
npm test
npm run build    # validates data, writes dist/
npm run preview  # serves dist/
```

## Drafts

Each file is `data/drafts/<id>.json`; its filename must match its ID.

```json
{
  "id": "comfort-teamfight",
  "title": "Comfort teamfight",
  "description": "Group around our first item timings.",
  "tags": ["comfort", "teamfight"],
  "bans": ["silencer"],
  "pos1": ["luna", "sven"],
  "pos5": ["disruptor", "lich"],
  "pos2": ["puck", "dragon_knight"],
  "pos4": ["phoenix", "rubick"],
  "pos3": ["tidehunter", "mars"]
}
```

Description, tags and bans are optional. Each position has 1–8 heroes; the first is primary and the rest are backups in priority order. Primaries must be unique; alternatives may be flex picks across positions. Hero IDs come from `data/heroes.json`. The editor handles their internal names for you.

Drafts use lane order: **1, 5 · 2 · 4, 3**. Key bans appear only in the opened draft. They are recommendations stored with the plan, separate from the current session's unavailable heroes.

Select a hero to use it in the lineup. Selecting it again leaves it selected. **Copy lineup** copies a link with the exact choices and the five hero names, grouped by lane. Opening that link restores the choices. A draft must be committed to GitHub before another browser can open it.

**New draft** and **Edit** open the visual editor. **Done** keeps your changes in this browser. **Save to GitHub** opens GitHub's authenticated editor for review and commit. New files are prefilled; existing files require copying their JSON into the GitHub editor. Uncommitted changes have an **Unsaved** badge and are retained in browser storage. In the editor, **Discard saved changes** restores the repository copy or removes an uncommitted new draft.

The three included plans are examples. Edit or remove their files to build the team's library.

## Controls

| Key | Action |
| --- | --- |
| / or Ctrl/⌘ K | Search |
| N | New draft |
| J / K | Next / previous draft |
| 1–5 | Focus a position in an opened draft |
| Enter in hero search | Add the first available result |
| Arrow keys in picker | Navigate heroes |
| Esc or click outside | Close a popup |
| ? | Shortcuts |

The hero picker groups all heroes by attribute. Search stays focused after selecting heroes. In the unavailable picker, Enter marks a result unavailable; clicking its portrait toggles availability.

## Matches

The match limit is fixed at **20**. Team defaults live in `data/config.json`. No settings or import/export UI is needed.

OpenDota's team-history table omits some amateur leagues. The supplied match `9082244244` belongs to the configured team but its league, E-Sparven Season 6, is marked excluded. The fallback uses that match's public roster to query tournament histories, then checks each candidate's actual team IDs. Games from other teams are excluded. The first sync recovered 20 complete lineups without an API key.

`historyMatchId` in config seeds this discovery. If the entire roster changes, replace it with a recent team match. Discovery checks the latest 20 tournament games for each public player in the seed match and verifies up to 40 candidates. This may not recover every old game or games absent from those public histories. Complete cached lineups are reused; failures preserve existing matches. Opponents without provider metadata are identified by team ID.

`data/matches.json` provides the shared snapshot. The Matches view refreshes stale data, and **Add match** can load a game by ID. Match hero order is taken from the game record, without guessing positions. **Create draft** lets you assign those heroes to positions.

```sh
npm run refresh:matches
```

Commit the updated snapshot to share it. Optional `manualMatches` entries in config use `{ "id": 9082244244, "side": "radiant" }`.

## Hosting and updates

The Pages workflow validates and builds pull requests, then deploys pushes to `main`. Set **Settings → Pages → Source: GitHub Actions**. Assets use content revision URLs so a release loads matching JavaScript and CSS. JSON is revalidated on load. The public site and bundled JSON are intentionally public.

No GitHub token is embedded in the application. A public PAT would expose its granted repository capabilities, including broader Actions access than a single draft submission. Direct in-app publishing would need an authenticated endpoint that keeps its GitHub credential private; the UI could remain on Pages.

```sh
npm run refresh:heroes
```

This refreshes the catalog from [odota/dotaconstants](https://github.com/odota/dotaconstants) and downloads missing Valve portraits. Commit `data/heroes.json` and `assets/heroes/`. Existing portraits are kept; remove one before refreshing to update its artwork.

Dota 2 names and artwork belong to Valve. This is an unofficial team tool.
