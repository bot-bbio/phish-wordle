// @ts-check
// Title normalization shared by the browser (search box) and the data scripts
// (joining song titles across phish.net, phish.in, and MusicBrainz).
//
// Each source spells titles slightly differently: curly vs straight quotes,
// "&" vs "and", accented letters, stray punctuation. Mapping every title to a
// canonical "key" lets us compare them with a plain string equality check.

/**
 * Reduce a title to a lowercase, punctuation-free comparison key.
 * "Mike's Song" -> "mikes song", "Stash & Friends" -> "stash and friends".
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return title
    .normalize('NFKD') // split accented letters into base letter + accent mark
    .replace(/[̀-ͯ]/g, '') // ...then drop the accent marks
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '') // apostrophes vanish: "mike's" -> "mikes"
    .replace(/[^a-z0-9]+/g, ' ') // any other punctuation becomes a space
    .trim()
    .replace(/\s+/g, ' ');
}
