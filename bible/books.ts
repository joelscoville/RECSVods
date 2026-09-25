/** Factual reference metadata. Aliases are case/space/period insensitive. */
export const BOOKS = [
  ['Genesis', 'Gen', 'Ge', 'Gn'], ['Exodus', 'Exod', 'Ex', 'Exo'],
  ['Leviticus', 'Lev', 'Le', 'Lv'], ['Numbers', 'Num', 'Nu', 'Nm', 'Nb'],
  ['Deuteronomy', 'Deut', 'Dt', 'Deu'], ['Joshua', 'Josh', 'Jos'],
  ['Judges', 'Judg', 'Jdg', 'Jdgs'], ['Ruth', 'Rth', 'Ru'],
  ['1 Samuel', '1 Sam', '1 Sa', '1 Sm'], ['2 Samuel', '2 Sam', '2 Sa', '2 Sm'],
  ['1 Kings', '1 Kgs', '1 Ki'], ['2 Kings', '2 Kgs', '2 Ki'],
  ['1 Chronicles', '1 Chron', '1 Chr', '1 Ch'], ['2 Chronicles', '2 Chron', '2 Chr', '2 Ch'],
  ['Ezra', 'Ezr'], ['Nehemiah', 'Neh', 'Ne'], ['Esther', 'Esth', 'Est'], ['Job', 'Jb'],
  ['Psalms', 'Psalm', 'Ps', 'Psa', 'Pss'], ['Proverbs', 'Prov', 'Pr', 'Prv'],
  ['Ecclesiastes', 'Eccl', 'Eccles', 'Ecc'], ['Song of Solomon', 'Song of Songs', 'Song', 'Songs', 'SOS', 'Canticles', 'Cant'],
  ['Isaiah', 'Isa', 'Is'], ['Jeremiah', 'Jer', 'Je', 'Jr'], ['Lamentations', 'Lam', 'La'],
  ['Ezekiel', 'Ezek', 'Eze', 'Ezk'], ['Daniel', 'Dan', 'Da', 'Dn'], ['Hosea', 'Hos', 'Ho'],
  ['Joel', 'Jl'], ['Amos', 'Am'], ['Obadiah', 'Obad', 'Ob'], ['Jonah', 'Jon', 'Jnh'],
  ['Micah', 'Mic', 'Mi'], ['Nahum', 'Nah', 'Na'], ['Habakkuk', 'Hab', 'Hb'],
  ['Zephaniah', 'Zeph', 'Zep'], ['Haggai', 'Hag', 'Hg'], ['Zechariah', 'Zech', 'Zec', 'Zc'],
  ['Malachi', 'Mal', 'Ml'], ['Matthew', 'Matt', 'Mt'], ['Mark', 'Mk', 'Mrk'],
  ['Luke', 'Lk', 'Luk'], ['John', 'Jn', 'Jhn'], ['Acts', 'Ac'], ['Romans', 'Rom', 'Ro', 'Rm'],
  ['1 Corinthians', '1 Cor', '1 Co'], ['2 Corinthians', '2 Cor', '2 Co'],
  ['Galatians', 'Gal', 'Ga'], ['Ephesians', 'Eph', 'Ephes'], ['Philippians', 'Phil', 'Php', 'Pp'],
  ['Colossians', 'Col', 'Co'], ['1 Thessalonians', '1 Thess', '1 Thes', '1 Th'],
  ['2 Thessalonians', '2 Thess', '2 Thes', '2 Th'], ['1 Timothy', '1 Tim', '1 Ti'],
  ['2 Timothy', '2 Tim', '2 Ti'], ['Titus', 'Tit', 'Ti'], ['Philemon', 'Philem', 'Phlm', 'Phm'],
  ['Hebrews', 'Heb'], ['James', 'Jas', 'Jm'], ['1 Peter', '1 Pet', '1 Pe', '1 Pt'],
  ['2 Peter', '2 Pet', '2 Pe', '2 Pt'], ['1 John', '1 Jn', '1 Jhn'],
  ['2 John', '2 Jn', '2 Jhn'], ['3 John', '3 Jn', '3 Jhn'], ['Jude', 'Jud'],
  ['Revelation', 'Rev', 'Re', 'Rv', 'Revelations', 'Apocalypse'],
] as const;
export const BIBLE_BOOKS = BOOKS.map(([name]) => name);

function aliasKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\./g, '').trim()
    .replace(/\s+/g, '');
}
const aliases = new Map(BOOKS.flatMap(([name, ...variants]) => [name, ...variants].flatMap((alias) => {
  const roman = alias.replace(/^[123]/, (number) => ['', 'I', 'II', 'III'][Number(number)]);
  return [alias, roman].map((value) => [aliasKey(value), name] as const);
})));
export function canonicalBook(value: string): string | undefined { return aliases.get(aliasKey(value)); }
