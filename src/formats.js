// What other tools receive. One neutral document (format "guide"), and two derived forms:
// "flat" (one language, plain strings) and "markdown" (for CMSs, docs, email tools).

export const FORMAT_VERSION = 1;

// The document a consumer gets: everything needed to render the guide, nothing engine-internal.
export function document(account, product, settings) {
  const facts = new Map((product.research?.facts || []).map(f => [f.id, f]));
  const used = new Set();
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.src)) n.src.forEach(id => used.add(id));
    Object.values(n).forEach(walk);
  })(product.guide);
  const p = product.page || {};
  return {
    formatVersion: FORMAT_VERSION,
    account: account.id,
    productId: product.id,
    url: product.url,
    shop: { name: account.name, domain: account.domain || null, accent: account.accent || null },
    product: { name: p.name || null, brand: p.brand || null, price: p.price || null, image: p.image || null, variants: p.variants || [] },
    languages: settings.languages,
    settings: { tone: settings.tone, formality: settings.formality, length: settings.length },
    guide: product.guide,
    sources: [...used].map(id => facts.get(id)).filter(Boolean).map(({ id, url, title, claim, category }) => ({ id, url, title, claim, category })),
  };
}

const isText = (o, langs) => o && typeof o === 'object' && !Array.isArray(o) && langs.every(l => typeof o[l] === 'string') && Object.keys(o).every(k => langs.includes(k));

// Same document, with every { nl, en } text replaced by the string in one language.
export function flat(doc, lang) {
  if (!doc.languages.includes(lang)) throw Object.assign(new Error(`Taal ${lang} zit niet in deze gids (${doc.languages.join(', ')})`), { status: 400 });
  const pick = n => Array.isArray(n) ? n.map(pick) : isText(n, doc.languages) ? n[lang] : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, pick(v)])) : n;
  return { ...doc, language: lang, languages: undefined, guide: pick(doc.guide) };
}

export function markdown(doc, lang) {
  const f = flat(doc, lang), g = f.guide, nr = new Map(f.sources.map((s, i) => [s.id, i + 1]));
  const cite = src => src?.length ? ' ' + src.filter(id => nr.has(id)).map(id => `[${nr.get(id)}]`).join('') : '';
  const L = [];
  L.push(`# ${g.title}`, '', `**${g.hook}**`, '', g.story.text + cite(g.story.src), '');
  L.push('## ' + (lang === 'nl' ? 'Wat je kunt verwachten' : 'What to expect'), '');
  for (const e of g.expect) L.push(`- **${e.lead}** ${e.text}${cite(e.src)}`);
  L.push('', `> ${g.fact.text}${cite(g.fact.src)}`, '');
  L.push(`## ${g.q.title}`, '', g.q.sub, '');
  for (const o of g.q.options) L.push(`- **${o.label}**${o.note ? ` (${o.note})` : ''}: ${o.h}. ${o.lines.join(' ')}${cite(o.src)}`);
  L.push('', `## Tips`, '');
  for (const [lv, name] of [['new', g.lq.new], ['reg', g.lq.reg], ['pro', g.lq.pro]]) {
    L.push(`### ${name}`, '');
    for (const t of g.tips[lv]) L.push(`- **${t.title}** ${t.text}${cite(t.src)}`);
    L.push('');
  }
  L.push(`### ${lang === 'nl' ? 'Per antwoord' : 'Per answer'}`, '');
  for (const t of g.answerTips) L.push(`- *${t.why}:* **${t.title}** ${t.text}${cite(t.src)}`);
  for (const m of [g.shipped, g.delivered]) {
    L.push('', `## ${m.title}`, '');
    for (const i of m.items) L.push(`- **${i.lead}** ${i.text}${cite(i.src)}`);
  }
  if (f.sources.length) {
    L.push('', `## ${lang === 'nl' ? 'Bronnen' : 'Sources'}`, '');
    f.sources.forEach((s, i) => L.push(`${i + 1}. [${s.title || s.url}](${s.url})`));
  }
  return L.join('\n') + '\n';
}

export function render(doc, format, lang) {
  if (!format || format === 'guide' || format === 'json') return { type: 'application/json', body: doc };
  if (format === 'flat') return { type: 'application/json', body: flat(doc, lang || doc.languages[0]) };
  if (format === 'markdown' || format === 'md') return { type: 'text/markdown; charset=utf-8', body: markdown(doc, lang || doc.languages[0]) };
  throw Object.assign(new Error('format: guide, flat of markdown'), { status: 400 });
}
