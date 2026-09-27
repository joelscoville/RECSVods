/** Shared authoring rule; independent of retired migration tooling. */
const minor = new Set('a an and as at but by for from in into nor of on or per the to via with without within through over under about against along before after between among amid despite onto than toward towards upon versus vs yet if so while when'.split(' '));
export function isTitleCase(title: string): boolean {
  const words = title.split(/[\s—–]+/u).filter(Boolean);
  return words.length > 0 && words.every((word, i) => (i > 0 && i < words.length - 1 && minor.has(word))
    || /^[^\p{L}]*[\p{Lu}\p{N}]/u.test(word));
}
