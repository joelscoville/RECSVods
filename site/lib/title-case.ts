/** Title Case: every main word capitalised, short joining words lower case. */
export const MINOR_TITLE_WORDS = new Set('a an and as at but by for from in into nor of on or per the to via with without within through over under about against along before after between among amid despite onto than toward towards upon versus vs yet if so while when'.split(' '));
export function isTitleCase(title: string): boolean {
  const words = title.split(/[\s—–]+/u).filter(Boolean);
  return words.length > 0 && words.every((word, i) => (i > 0 && i < words.length - 1 && MINOR_TITLE_WORDS.has(word))
    || /^[^\p{L}]*[\p{Lu}\p{N}]/u.test(word));
}
