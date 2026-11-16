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

Select a hero to use it in the lineup. Selecting it again leaves it selected. **Copy lineup** copies a Discord Markdown link, with the draft title as its text and embeds suppressed, followed by the five hero names grouped by lane. Opening the link restores those choices. A draft must be committed to GitHub before another browser can open it.

**New draft** and **Edit** open the visual editor. **Done** keeps your changes in this browser. **Save to GitHub** uses the authenticated GitHub editor by default. If an HTTPS publishing relay is configured, it submits the draft directly and waits for its result. Uncommitted changes have an **Unsaved** badge. The floating **Continue editing** control resumes unfinished work; its X discards that unfinished edit. In the editor, **Discard saved changes** restores the repository copy or removes an uncommitted new draft.

The three included plans are examples. Edit or remove their files to build the team's library.

## Controls

Type to search the current screen without clicking its search field first. Text fields in the editor keep their normal typing behavior. Enter in hero search selects the first available result. Escape or a click outside closes a popup; Escape on the main screen clears search. Ordinary Tab navigation remains available. There are no letter shortcuts.

The fullscreen workspace uses top navigation for Drafts, Matches and starred plans. Tags remain searchable. Hero pickers group heroes by attribute and use compact landscape portraits. Search stays focused after selecting heroes.

**Our picks** shows green chips and ranks drafts by how many of those heroes appear anywhere in the plan, including alternatives. Complete matches appear first, followed by partial matches; no plan is removed by these picks. Each card reports its matched count. Unavailable heroes use red chips. A hero cannot be both picked by us and unavailable.

## Matches

The match limit is fixed at **20**. Team defaults live in `data/config.json`. No settings or import/export UI is needed.

OpenDota's team-history table omits some amateur leagues. The supplied match `9082244244` belongs to the configured team but its league, E-Sparven Season 6, is marked excluded. The fallback uses that match's public roster to query tournament histories, then checks each candidate's actual team IDs. Games from other teams are excluded. The first sync recovered 20 complete lineups without an API key.

`historyMatchId` in config seeds this discovery. Later refreshes use the newest known team match to follow roster changes. If the entire roster changes before another match is discovered, replace the seed with a recent team match. Discovery checks the latest 20 tournament games for each public player and verifies up to 40 candidates. It may not recover games absent from those public histories. Complete cached lineups are reused; failures preserve existing matches. Opponents without provider metadata are identified by team ID.

`data/matches.json` provides the shared snapshot. The Matches view refreshes stale data, and **Add match** can load a game by ID. Match hero order is taken from the game record, without guessing positions. **Create draft** lets you assign those heroes to positions.

```sh
npm run refresh:matches
```

The **Refresh matches** workflow also runs every Monday morning (07:17 in Sweden in winter, 08:17 in summer) and can be run manually. It commits the snapshot, then triggers Pages publication. No API key or self-hosted runner is needed. Optional `manualMatches` entries in config use `{ "id": 9082244244, "side": "radiant" }`.

## Hosting and updates

The Pages workflow validates and builds pull requests, then deploys pushes to `main`. It also runs after successful **Save draft** and **Refresh matches** workflows, because commits made using `GITHUB_TOKEN` do not trigger ordinary push workflows. Set **Settings → Pages → Source: GitHub Actions**. Assets use content revision URLs; JSON is revalidated on load.

The build publishes no GitHub credentials. The earlier public-token experiment has been removed; any PAT used in that deployment should be revoked. `PUBLIC_DRAFT_DISPATCH_TOKEN` is no longer read by the Pages workflow or build.

For direct saving, set `publishEndpoint` in `data/config.json` to an HTTPS relay URL. The relay keeps the repo-only Actions credential server-side, accepts a validated draft at `POST /draft`, dispatches only `save-draft.yml` on `main`, and returns `{ "id": <run ID>, "url": <run URL> }`. `GET /runs/<id>` returns its status and conclusion. The browser sends no GitHub token. The build permits that relay's origin in the content security policy. Without a relay, the GitHub editor handoff stays available.

The save workflow receives JSON through an environment variable, validates size and hero IDs, strips unknown fields, and writes only `data/drafts/<validated-id>.json`. The relay's credential needs only Actions access; the workflow uses its own `GITHUB_TOKEN` to commit. An existing draft requires its previous content fingerprint so simultaneous edits cannot silently overwrite one another. Save and refresh jobs share a concurrency group.

```sh
npm run refresh:heroes
```

This refreshes the catalog from [odota/dotaconstants](https://github.com/odota/dotaconstants) and downloads missing Valve portraits. Commit `data/heroes.json` and `assets/heroes/`. Existing portraits are kept; remove one before refreshing to update its artwork.

Dota 2 names and artwork belong to Valve. This is an unofficial team tool.
