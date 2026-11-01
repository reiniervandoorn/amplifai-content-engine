// The content in one language: every { nl, en } text replaced by the string in that language.
// Handy for a tool that shows one language at a time; revisions still need the full result.

const isText = (o, langs) => o && typeof o === 'object' && !Array.isArray(o) && langs.every(l => typeof o[l] === 'string') && Object.keys(o).every(k => langs.includes(k));

export function flat(result, lang) {
  if (!result.languages.includes(lang)) throw Object.assign(new Error(`Taal ${lang} zit niet in deze inhoud (${result.languages.join(', ')})`), { status: 400 });
  const pick = n => Array.isArray(n) ? n.map(pick) : isText(n, result.languages) ? n[lang] : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, pick(v)])) : n;
  return { ...result, language: lang, content: pick(result.content) };
}
