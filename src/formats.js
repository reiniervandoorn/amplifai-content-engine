// The result in one language: the guides of that language only, for a tool that works one language at a time.
// A revision still needs the full result.
export function oneLanguage(result, lang) {
  if (!result.languages.includes(lang)) throw Object.assign(new Error(`Taal ${lang} zit niet in deze gidsen (${result.languages.join(', ')})`), { status: 400 });
  return { ...result, language: lang, guides: { [lang]: result.guides[lang] } };
}
