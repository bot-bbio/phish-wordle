# Phishle

A daily guess-the-song game for Phish fans, in the style of
[Spotle](https://spotle.io). You get 10 tries to name the mystery song. Each guess
shows its album cover and how it compares to the answer on six clues:

| Clue | What it means | Green | Yellow | Arrow |
|---|---|---|---|---|
| **Album** | The album the song is filed under (see below) | Same album | Released within 3 years | Answer's album is later ˄ / earlier ˅ |
| **Debut** | Year Phish first played it live | Same year | Within 2 years | Answer debuted later ˄ / earlier ˅ |
| **Played** | Times played live | Same count | Within 25% of the answer's count | Answer played more ˄ / less ˅ |
| **Last played** | Month of the most recent performance | Same as Gap | Same as Gap | Answer played more recently ˄ / longer ago ˅ |
| **Gap** | Shows since it was last played | Same gap | Within 10 shows | Answer's gap is bigger ˄ / smaller ˅ |
| **Longest jam** | Longest standalone live version with audio | Within 1 minute | Within 5 minutes | Answer's is longer ˄ / shorter ˅ |

**Last played and Gap are one fact in two formats** (a date vs. a count of shows), both
from the same phish.net snapshot. Last played takes its color from the Gap comparison,
so the two tiles always agree; their arrows point opposite ways because a bigger gap
means an earlier date. A test checks this against every real song pair.

**Albums.** A song on several albums is filed under one, in this order:

1. *The Man Who Stepped into Yesterday* (1988, the Gamehendge thesis) claims every song
   on it: *Possum*, *Wilson*, *The Lizards*, *AC/DC Bag*.
2. Otherwise its earliest studio album: *You Enjoy Myself* is a *Junta* song.
3. Otherwise the 1986 *White Tape* demo: *Slave to the Traffic Light*.
4. Otherwise its earliest live album (*A Live One*, *Slip Stitch and Pass*,
   *Kasvot Växt: í rokk*): *Harry Hood*, *Mike's Song*, *Turtle in the Clouds*.

Songs on no album show **None** with a placeholder disc. Two "None" songs match; "None"
against a real album is a plain miss with no arrow.

A few songs show **—** for longest jam: phish.in has no standalone audio for them,
usually because they're always filed inside a medley track ("Alumni Blues > Letter to
Jimmy Page > Alumni Blues").

Every guessable song Phish has played (originals and covers) can be entered. Fan
shorthand works in the search box: `YEM`, `DWD`, `CDT`. Daily answers are band
originals played at least 40 times, plus album songs (covers included) played at least 5
times. **Practice mode** (∞) serves random songs
without affecting your stats.

Install it on your phone with **Share → Add to Home Screen** (iOS) or **Install app**
(Android). It works offline after the first visit.

## Data sources

| Data | Source |
|---|---|
| Song list, debut date, gap, times played | [Phish.net API v5](https://docs.phish.net/) |
| Longest version (duration, date, venue) | [phish.in API v2](https://phish.in/api-docs) |
| Album tracklists | Hand-maintained [data/albums.json](data/albums.json), checked against [Wikipedia](https://en.wikipedia.org) and [MusicBrainz](https://musicbrainz.org) |
| Album covers | [Cover Art Archive](https://coverartarchive.org) and Wikipedia, saved as 250px thumbnails in `img/albums/` |
| Font | [Inter](https://rsms.me/inter/) (SIL Open Font License, see `fonts/OFL.txt`) |

Song data courtesy of Phish.net and The Mockingbird Foundation, used under their
non-commercial license. Phishle is free, fan-made, and not affiliated with Phish.
The layout is modelled on Spotle; no Spotle code or assets are used.

Made by bot-bbio · [LinkedIn](https://www.linkedin.com/in/alvvays/) · [GitHub](https://github.com/bot-bbio)

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
| `npm run art` | Download cover thumbnails for any album in `data/albums.json` that lacks one |
| `node scripts/reshuffle-schedule.mjs` | Reshuffle future puzzles after a big change to the answer pool (never touches a puzzle any time zone has reached) |
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
  build-data.mjs         phish.net + phish.in + data/albums.json -> data/songs.json, data/schedule.json
  fetch-album-art.mjs    Cover Art Archive / Wikipedia -> img/albums/*.jpg
  reshuffle-schedule.mjs one-off: reshuffle not-yet-reached puzzles
data/                    albums.json (hand-edited) + baked JSON; the only data the browser reads
img/albums/              cover thumbnails, served from this site (works offline, no third-party requests)
fonts/                   self-hosted Inter
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

**Album.** phish.net has no discography endpoint, and Phish releases albums rarely, so
the tracklists live in a hand-maintained `data/albums.json` (title, year, type, tracks).
Each album's `type` (`thesis`, `studio`, `demo`, `live`) drives the filing order
above. Album years are original release years (*Junta* is 1989, not its 1992 CD
reissue). Tracks that never match a phish.net song (studio-only cuts, *Montana*, which is a
*Tweezer* excerpt) are logged by the build and ignored. To add an album, append it to
the file in release order, run `npm run art`, then `npm run data`.
