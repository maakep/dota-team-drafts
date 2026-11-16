# dota-team-drafts

A static draft library for **De 4 clownerna och Poppe**, team `9838881`.

Hero portraits come first. Five positions, ordered backups, searchable notes and tags. No framework, database, account system, analytics, or npm dependencies. All hero data and portraits are in the repository. Only refreshing match history calls an external API.

## Run locally

Requires Node.js 22 or newer. No install step.

```sh
npm run dev
```

Open <http://127.0.0.1:4173>. Source changes rebuild the site; reload the browser to see them.

```sh
npm test          # validation, lineup resolution, GitHub links, OpenDota behavior
npm run build    # validates data and writes dist/
npm run preview  # serves an existing dist/
```

## Draft files

Each draft lives in `data/drafts/<id>.json`. The filename must match `id`.

```json
{
  "id": "comfort-teamfight",
  "title": "Comfort teamfight",
  "description": "Group around our first item timings.",
  "tags": ["comfort", "teamfight"],
  "pos1": ["luna", "sven"],
  "pos2": ["puck", "dragon_knight"],
  "pos3": ["tidehunter", "mars"],
  "pos4": ["phoenix", "rubick"],
  "pos5": ["disruptor", "lich"]
}
```

`description` and `tags` are optional. Index 0 is the primary hero; subsequent entries are backups in priority order. Use 1–8 heroes per position. Primary heroes must be different; a backup can appear in several positions for flex picks. IDs are Valve internal names from `data/heroes.json`, such as `skeleton_king` for Wraith King. The UI uses display names and supports common search aliases.

The three included drafts are tagged `example`. Edit or remove their JSON files as you build your own library.

## Using the library

- Search names, notes, tags, hero names, and backup heroes. The position filter limits hero matching to a specific slot.
- Star drafts to keep them first. Filter by tag or browser drafts in the sidebar.
- Mark bans and enemy picks under **Unavailable heroes**. Draft previews resolve the first available complete lineup with five unique heroes, accounting for flex alternatives.
- Open a draft to see and lock alternatives. Click a locked hero again to release it. These choices affect only the current view; they do not edit the saved plan.
- **New draft** opens a visual editor. Reorder alternatives with the arrow buttons. Unfinished changes are recoverable through **Continue editing**.
- **Save draft** stores a browser copy. **Export JSON** downloads a portable file. **Export library** downloads the full visible library, including browser edits. **Import JSON** accepts a single draft or an array and asks before replacing matching IDs.

Browser copies, stars, unavailable heroes, settings, and match caches use `localStorage` on that browser and origin. They are not shared across devices. Export valuable changes before clearing browser data. Repository drafts with local edits are labeled **Local edits**. Open a draft and choose **Discard local edits** to restore its repository version, or **Remove browser draft** to remove a local draft. Both ask before removing the browser copy.

### Keyboard

| Key | Action |
| --- | --- |
| `/` or Ctrl/⌘ K | Search |
| `N` | New draft |
| `J` / `K` | Focus next / previous draft |
| Enter | Open a focused draft or activate a control |
| `1`–`5` | Focus a position in draft view |
| Arrow keys | Navigate heroes in the picker |
| Esc | Close the current dialog |
| `?` | Shortcut reference |

Shortcuts do not run while typing. Tab navigation and visible focus indicators work throughout. The layout adapts to narrow screens and respects reduced motion.

## Sending drafts to GitHub

No token is needed or stored in the application.

1. Create or edit a draft and save it in the browser.
2. Choose **Send to GitHub**.
3. For a new draft, open the prefilled GitHub file editor. For an existing file, copy the JSON, open its editor, and replace the file contents. A copy/download fallback is available if a URL is too long or clipboard access is unavailable.
4. Review and commit, or propose the change on a branch. GitHub checks the signed-in user's repository permissions. A commit on `main` triggers Pages; a pull request runs validation before it is merged.

The local copy remains available during deployment. If you edit the same draft on another device, compare or remove your browser override before relying on the repository version.

A fine-grained PAT with **Actions: write** can dispatch workflows, but that is a repository permission, not a one-action secret. A token embedded in a static page is available to visitors. This project uses GitHub's own authenticated editor instead. If one-click in-app team publishing becomes necessary, use a small authenticated server or GitHub App to keep credentials off the page.

## Team and match history

Defaults are in `data/config.json`. The Settings dialog can override team name, team ID and match limit in one browser. Export `config.json` and commit it to change the shared defaults.

Match history uses [OpenDota's public API](https://docs.opendota.com/):

- `/teams/{team_id}` for the team name when available.
- `/teams/{team_id}/matches` for match summaries.
- `/matches/{match_id}` for the heroes on each side.

An API key is not required. A key raises usage limits; parsed replay fields depend on replay availability and parsing, not simply on having a key. This app only needs hero picks. It makes requests sequentially, reuses complete cached matches, caches results by team, and preserves cached data during API failures. Visiting Matches refreshes stale history; **Refresh** requests another update.

On November 16, 2026, OpenDota returned an empty team metadata response and no tracked matches for `9838881`. Missing amateur/private-lobby history is an API coverage limit. The UI explains this and supports **Add match** with a match ID. If the match lacks team IDs, select your side explicitly. A match must still be available in OpenDota.

Matches show each side's heroes without assigning positions 1–5. **Create draft** from a match asks you to assign the heroes to positions.

To refresh the shared JSON snapshot without a browser:

```sh
npm run refresh:matches
```

Commit the resulting `data/matches.json`. For missing matches, add entries to `manualMatches` in `data/config.json`:

```json
"manualMatches": [
  { "id": 8123456789, "side": "radiant" }
]
```

Use real match IDs; the number above only illustrates the format. The UI can export its match snapshot and config too. Only the snapshot matching the configured team is shown. No STRATZ dependency or API secret is involved.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` validates, builds and publishes `dist/` on pushes to `main`. Pull requests validate and build without deployment. Actions are pinned to commit SHAs; only the deploy job has Pages/OIDC write permissions. No PAT or repository content-write token is needed.

In the repository, select **Settings → Pages → Build and deployment → Source: GitHub Actions**. Push the project to `main`. The site is served at:

<https://maakep.github.io/dota-team-drafts/>

All asset and data paths are relative, so repository subpaths work without a base-path setting. A draft can be linked directly with `#draft/<id>`.

Pages content is public, including the bundled JSON, even when a source repository is private on a plan that supports private-source Pages. Private site access requires eligible GitHub Enterprise hosting. Public hosting is intentional for this project.

## Updating hero data

```sh
npm run refresh:heroes
```

This downloads the catalog from [odota/dotaconstants](https://github.com/odota/dotaconstants) and missing portraits from Valve's Steam CDN. Commit `data/heroes.json` and `assets/heroes/`. Builds use those local copies and do not depend on the CDN or API. Existing portraits are kept; remove a specific portrait before refreshing if its artwork needs an update.

Dota 2 hero names and artwork belong to Valve. This is an unofficial team tool.
