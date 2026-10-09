# Phishle

A daily guess-the-song game for Phish fans, in the style of
[Spotle](https://spotle.io). You get 10 tries to name the mystery song. Each guess
shows how it compares to the answer on four clues:

| Clue | What it means | Green | Yellow | Arrow |
|---|---|---|---|---|
| **Album** | First studio album the song appeared on | Same album | The album released just before or after | Answer's album is later ↑ / earlier ↓ |
| **Debut** | Year Phish first played it live | Same year | Within 2 years | Answer debuted later ↑ / earlier ↓ |
| **Gap** | Shows since it was last played | Same gap | Within 10 shows | Answer's gap is bigger ↑ / smaller ↓ |
| **Longest jam** | Longest standalone live version with audio | Within 1 minute | Within 5 minutes | Answer's is longer ↑ / shorter ↓ |

Songs never released on a studio album show **None**. Two "None" songs match;
"None" against a real album is a plain miss with no arrow. The 1986 *White Tape* demo
counts only for songs on no other studio album, so *You Enjoy Myself* is a *Junta* song
and *AC/DC Bag* is a *White Tape* song.

A few songs show **—** for longest jam: phish.in has no standalone audio for them,
usually because they're always filed inside a medley track ("Alumni Blues > Letter to
Jimmy Page > Alumni Blues").

Every guessable song Phish has played (originals and covers) can be entered. Fan
shorthand works in the search box: `YEM`, `DWD`, `CDT`. Answers are drawn only from
Phish originals played at least 40 times. **Practice mode** (∞) serves random songs
without affecting your stats.

Install it on your phone with **Share → Add to Home Screen** (iOS) or **Install app**
(Android). It works offline after the first visit.

## Data sources

| Data | Source |
|---|---|
| Song list, debut date, gap, times played | [Phish.net API v5](https://docs.phish.net/) |
| Longest version (duration, date, venue) | [phish.in API v2](https://phish.in/api-docs) |
| Studio album tracklists | [MusicBrainz](https://musicbrainz.org), with a hand-curated album list |

Song data courtesy of Phish.net and The Mockingbird Foundation, used under their
non-commercial license. Phishle is free, fan-made, and not affiliated with Phish.

## Setup

Requires Node.js 20+. There are no npm dependencies.

```sh
cp .env.example .env        # then paste your phish.net API key into .env
npm run data                # bake data/songs.json and data/schedule.json
npm run serve               # http://localhost:8080
npm test                    # unit tests for the game rules
```

Get a phish.net API key at <https://phish.net/api/keys>.

| Command | What it does |
|---|---|
| `npm run data` | Incremental data refresh. Re-checks phish.in durations only for recently played songs |
| `npm run data:full` | Re-query every song on phish.in (~1,000 requests, several minutes) |
| `npm run discography` | Re-pull album tracklists from MusicBrainz (only needed when a new album comes out) |
| `npm run icons` | Regenerate the app icons |

## Deployment

The site is static files served from the `main` branch on GitHub Pages:

```sh
gh repo edit --enable-pages --pages-branch main
```

A scheduled GitHub Action ([.github/workflows/refresh-data.yml](.github/workflows/refresh-data.yml))
refreshes the data every morning and commits it if anything changed. The Pages
deploy follows automatically. Add the API key as a repository secret named
`PHISHNET_API_KEY`:

```sh
gh secret set PHISHNET_API_KEY
```

## Architecture

```
scripts/                 (Node, runs at build time; holds the API key)
  build-data.mjs         phish.net + phish.in + discography -> data/songs.json, data/schedule.json
  fetch-discography.mjs  MusicBrainz -> data/discography.json
data/                    baked JSON, committed; the only data the browser reads
js/                      (browser, ES modules, no build step)
  game.js                pure rules: comparisons, daily calendar, search, stats, share text
  normalize.js           title normalization, shared by browser search and data scripts
  storage.js             validated localStorage persistence
  app.js                 DOM rendering and input handling
sw.js                    service worker (offline + installable)
```

**Why bake data at build time instead of calling the APIs from the browser?**
A static site can't keep a secret: any API key shipped to the browser is readable in
devtools. Baking also means one scheduled request batch per day instead of one per
player, which is what phish.net asks of API consumers. And the historical data
hardly ever changes.

**Daily puzzle.** `data/schedule.json` holds a shuffled list of answer song IDs and an
epoch date. Puzzle *N* is `order[N mod length]`, computed from the player's local date,
so everyone gets the same song on the same calendar day with no server. New eligible
songs are appended to the end, never inserted, so past and current puzzles never change
when the data refreshes.

**Longest jam.** phish.net records track times for under 2% of performances, so
durations come from phish.in's audio archive. A track that bundles several songs
(e.g. "YEM > Jam") is skipped, so a medley never counts as one song's jam. Soundchecks
and tracks phish.in excludes from stats are skipped too.

**Album.** phish.net has no discography endpoint. The album list is curated in
`scripts/fetch-discography.mjs` because MusicBrainz's raw catalog includes side projects
and reissue dates (it dates *Junta* to 1992, not 1989). For each album, the script takes the
official edition with the fewest tracks to leave out bonus live cuts.
