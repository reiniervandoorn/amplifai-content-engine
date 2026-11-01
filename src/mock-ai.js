// Test mode: the same three functions as ai.js, without Claude. Everything around them runs for real
// (reading the product page, jobs, settings, the quality check); only the words come from fixed templates.
// The output follows the same schema and the same settings (languages, formality, tone, counts),
// so the AmplifAI tool can be built against it without an Anthropic key and at no cost.
// Dutch and English are written out; German and French reuse the English text with a [DE]/[FR] tag.
import { schemas, getPath, kindOf } from './ai.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const NOUSAGE = { input: 0, output: 0, searches: 0 };

/* ── word lists. {je}/{jouw}/{Je}/{Jouw} become je/jouw or u/uw in Dutch ── */
const HEADLINE = {
  warm:    [['Dit wordt een fijne eerste week.', 'This will be a good first week.'], ['Goed gekozen. Zo haal {je} er alles uit.', 'Good choice. Here is how to get the most out of it.']],
  neutral: [['Alles wat {je} moet weten, kort.', 'Everything you need to know, briefly.'], ['De eerste week, in drie punten.', 'The first week, in three points.']],
  expert:  [['Zo werkt hij, en zo blijft hij goed.', 'How it works, and how to keep it that way.'], ['De details die het verschil maken.', 'The details that make the difference.']],
  playful: [['Spoiler: {je} gaat hem vaak gebruiken.', 'Spoiler: you will use it a lot.'], ['Uitpakken mag. Eerst even dit.', 'Unboxing is allowed. First, this.']],
};
const EXPECT = [
  ['box', 'Even wennen is normaal.', 'Getting used to it takes a moment.', 'Nieuwe spullen voelen de eerste dagen vaak anders dan {je} verwacht. Geef het een paar keer gebruik.', 'New things often feel different from what you expect for the first few days. Give it a few uses.'],
  ['alert', 'Een nieuwe geur verdwijnt vanzelf.', 'A new smell fades by itself.', 'Veel producten ruiken de eerste dagen naar de fabriek. Laat het even luchten.', 'Many products smell of the factory for the first days. Let it air for a while.'],
  ['clock', 'Na een week weet {je} het.', 'After a week, you know.', 'Hoe het na een week gebruik voelt, zo blijft het ongeveer.', 'How it feels after a week of use is roughly how it will stay.'],
  ['tool', 'Afstellen hoort erbij.', 'Adjusting is part of it.', 'Een kleine aanpassing in de eerste dagen maakt vaak het grootste verschil.', 'A small adjustment in the first days often makes the biggest difference.'],
];
const TIPS = [
  ['pen', 'Noteer de aankoopdatum', 'Note the purchase date', 'Handig voor garantie en om te weten wanneer onderhoud nodig is.', 'Useful for warranty and to know when maintenance is due.'],
  ['box', 'Bewaar de doos even', 'Keep the box for now', 'Mocht {je} willen ruilen, dan is de originele doos handig.', 'If you want to exchange it, the original box is handy.'],
  ['clock', 'Begin rustig', 'Start gently', 'De eerste keren kort gebruiken geeft {je} tijd om te wennen.', 'Short first uses give you time to get used to it.'],
  ['link', 'Kijk wat er in de doos zit', 'Check what is in the box', 'Soms zit er een klein onderdeel bij dat het gebruik makkelijker maakt.', 'Sometimes a small part is included that makes use easier.'],
  ['swap', 'Afwisselen helpt', 'Alternating helps', 'Wat {je} vaak gebruikt, gaat langer mee als het af en toe kan rusten.', 'Things you use often last longer when they can rest now and then.'],
  ['route', 'Probeer het eerst thuis', 'Try it at home first', 'Zo ontdek {je} rustig hoe alles werkt, zonder haast.', 'That way you calmly find out how everything works, without hurry.'],
  ['gauge', 'Let op hoe het slijt', 'Watch how it wears', 'Kleine veranderingen zie {je} het eerst op plekken die het meest gebruikt worden.', 'You notice small changes first where it is used most.'],
  ['volume', 'Vraag het de shop', 'Ask the shop', 'Klopt er iets niet of twijfel {je}? De shop helpt graag.', 'Something not right, or unsure? The shop is happy to help.'],
  ['phone', 'Zoek de handleiding online op', 'Look up the manual online', 'Een digitale versie is handig als het papiertje zoekraakt.', 'A digital copy is handy when the paper one goes missing.'],
  ['bell', 'Let op hoe het voelt', 'Notice how it feels', 'Voelt iets anders dan verwacht? Dat zegt vaak iets over de afstelling.', 'Something feels different than expected? That often says something about the set-up.'],
  ['walk', 'Bouw het rustig op', 'Build up gradually', 'Langer of vaker gebruiken gaat het fijnst stap voor stap.', 'Using it longer or more often works best step by step.'],
  ['home', 'Geef het een vaste plek', 'Give it a fixed spot', 'Wat een vaste plek heeft, is sneller gepakt en raakt minder snel beschadigd.', 'What has a fixed spot is quicker to grab and less likely to get damaged.'],
];
const SPECIAL = [
  ['gauge', 'Gemaakt voor dagelijks gebruik', 'Made for everyday use', 'Testmodus: hier komt wat dit product bijzonder maakt, uit de bronnen.', 'Test mode: what makes this product special, from the sources, goes here.'],
  ['tool', 'Doordacht ontwerp', 'A thoughtful design', 'Testmodus: hier komt een tweede bijzonder punt, met bron.', 'Test mode: a second special point, with a source, goes here.'],
  ['shield', 'Gaat lang mee', 'Built to last', 'Testmodus: nog een bijzonder punt uit de bronnen.', 'Test mode: another special point from the sources.'],
];
const CARE = [
  ['drop', 'Schoonmaken met een zachte doek', 'Clean with a soft cloth', 'Een vochtige, zachte doek is meestal genoeg. Agressieve middelen zijn zelden nodig.', 'A damp, soft cloth is usually enough. Harsh cleaners are rarely needed.'],
  ['thermo', 'Droog en uit de zon bewaren', 'Store dry and out of the sun', 'Vocht en direct zonlicht verouderen de meeste materialen het snelst.', 'Moisture and direct sunlight age most materials fastest.'],
  ['shield', 'Lees het onderhoudslabel', 'Read the care label', 'Daar staat precies hoe {je} het lang mooi houdt.', 'It says exactly how to keep it in good shape.'],
  ['cal', 'Plan een vast onderhoudsmoment', 'Plan a regular maintenance moment', 'Eén keer per maand even nalopen voorkomt de meeste problemen.', 'Checking it once a month prevents most problems.'],
];
const SHIPPED = [
  ['home', 'Kies een plek.', 'Pick a spot.', 'Bedenk waar {je} het gaat gebruiken of bewaren.', 'Think about where you will use or store it.'],
  ['cal', 'Plan een rustig moment.', 'Plan a quiet moment.', 'Uitpakken en uitproberen gaat het fijnst zonder haast.', 'Unpacking and trying it out is nicest without hurry.'],
  ['tool', 'Leg gereedschap klaar.', 'Have tools ready.', 'Een schaar of mesje voor de verpakking is handig.', 'Scissors or a knife for the packaging comes in handy.'],
  ['phone', 'Zet de handleiding klaar.', 'Have the manual ready.', 'Vaak staat die ook online, handig om vooraf even te bekijken.', 'It is often online too, handy to glance at beforehand.'],
];
const DELIVERED = [
  ['box', 'Check of alles compleet is.', 'Check that everything is there.', 'Kijk de inhoud na voordat {je} de verpakking weggooit.', 'Go through the contents before throwing the packaging away.'],
  ['walk', 'Probeer het binnen even uit.', 'Try it indoors first.', 'Zo blijft het schoon als {je} toch wilt ruilen.', 'That way it stays clean if you want to exchange it after all.'],
  ['pen', 'Bewaar de bon.', 'Keep the receipt.', 'De bevestigingsmail is genoeg, maar zet hem in een map.', 'The confirmation email is enough, but put it in a folder.'],
  ['link', 'Stel het goed af.', 'Set it up properly.', 'Neem vijf minuten om het naar {jouw} smaak in te stellen.', 'Take five minutes to set it up the way you like.'],
];
const OPTIONS = [
  ['dagelijks', 'Elke dag', 'Every day', 'Dan telt onderhoud extra', 'Then care counts extra', true, 'Bij dagelijks gebruik loont een vast onderhoudsmoment.', 'With daily use, a regular care moment pays off.'],
  ['weekend', 'In het weekend', 'At weekends', 'Prima ritme', 'A fine rhythm', true, 'Berg het tussendoor droog en schoon op.', 'Store it dry and clean in between.'],
  ['speciaal', 'Voor iets speciaals', 'For something special', 'Probeer het eerst uit', 'Try it out first', false, 'Gebruik het een paar keer vóór het moment zelf.', 'Use it a few times before the moment itself.'],
  ['weetniet', 'Weet ik nog niet', 'Not sure yet', 'Ontdek het rustig', 'Find out at your pace', true, 'Begin met korte momenten en kijk wat bevalt.', 'Start with short moments and see what you like.'],
];

/* ── turning a Dutch/English pair into the languages and form of address the settings ask for ── */
function texter(s) {
  const formal = s.formality === 'formal';
  const nlForm = t => t.replace(/\{je\}/g, formal ? 'u' : 'je').replace(/\{jouw\}/g, formal ? 'uw' : 'jouw')
    .replace(/\{Je\}/g, formal ? 'U' : 'Je').replace(/\{Jouw\}/g, formal ? 'Uw' : 'Jouw');
  return (nl, en) => Object.fromEntries(s.languages.map(l => [l, l === 'nl' ? nlForm(nl) : l === 'en' ? en : `[${l.toUpperCase()}] ${en}`]));
}
const pick = (list, n, seed) => {
  const out = [];
  for (let i = 0; i < n && list.length; i++) out.push(list[(seed + i) % list.length]);
  return out;
};

// "Men's Canvas Runner NZ - Deep Navy (Blizzard Sole)" → "Canvas Runner NZ"
function shortName(page) {
  let n = String(page.name || '').split(/\s[-–|]\s/)[0].replace(/\(.*?\)/g, '').replace(/^(men'?s|women'?s|heren|dames|kids)\s+/i, '').trim();
  if (page.brand && n.toLowerCase().startsWith(page.brand.toLowerCase() + ' ')) n = n.slice(page.brand.length + 1);
  return n.split(/\s+/).slice(0, 3).join(' ') || page.name || 'product';
}

/* ── research: the shop page itself is the only source ── */
export async function research(page, settings, { onProgress } = {}) {
  const brand = page.brand || 'het merk', name = page.name || 'dit product';
  onProgress?.(`Testmodus: zoekt naar ${brand} ${name}`); await wait(250);
  onProgress?.(`Testmodus: leest ${page.url}`); await wait(250);
  const sentences = String(page.descriptionHtml || page.description || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 25 && x.length < 260).slice(0, 5);
  const claims = [
    ['brand', `${name} is made by ${brand}.`],
    ...(page.price ? [['special', `The shop sells it for ${page.price}.`]] : []),
    ...(page.variants?.length ? [['compat', `It comes in these variants: ${page.variants.slice(0, 5).join(', ')}.`]] : []),
    ...(page.properties || []).slice(0, 4).map(p => ['special', `Spec from the shop: ${p}.`]),
    ...sentences.map(t => ['special', `From the product description: "${t}"`]),
    ['care', 'The shop page is the only source used in test mode.'],
  ];
  return {
    product: { brand: page.brand, name: page.name, short_name: shortName(page), price: page.price, what_it_is: page.category || 'product', key_specs: (page.properties || []).slice(0, 4) },
    facts: claims.map(([category, claim], i) => ({ id: 'f' + (i + 1), category, claim, url: page.url, title: 'Productpagina', snippet: '' })),
    dropped: 0,
    questionIdeas: [{ question: 'How often will you use it?', options: ['Every day', 'At weekends', 'Not sure yet'], why: 'Changes the care advice.' }],
    usage: NOUSAGE,
    mock: true,
  };
}

/* ── writing ── */
function build({ page, research: r, settings: s, seed = 0 }) {
  const T = texter(s);
  const fid = cat => r.facts.find(f => f.category === cat)?.id;
  const src = cat => (fid(cat) ? [fid(cat)] : []);
  const name = page.name || 'product', brand = page.brand || '', short = (r.product?.short_name || name).trim() || name;
  const heads = HEADLINE[s.tone] || HEADLINE.warm, h = heads[seed % heads.length];
  const point = ([icon, ln, le, tn, te], cat) => ({ icon, lead: T(ln, le), text: T(tn, te), src: cat ? src(cat) : [] });
  const tip = ([icon, tn, te, dn, de], cat) => ({ icon, title: T(tn, te), text: T(dn, de), src: cat ? src(cat) : [] });
  const tips = pick(TIPS, s.tipCount * 3, seed);
  const opts = pick(OPTIONS.slice(0, 3), s.answerCount - 1, seed).concat([OPTIONS[3]]);
  // quote the shop's description only when it does not address the reader (that would clash with je/u)
  const descFact = r.facts.find(f => f.claim.startsWith('From the product description') && !/\b(je|jij|jouw|jou|u|uw)\b/i.test(f.claim));
  return {
    shortName: T(short, short),
    intro: {
      title: T(`{Jouw} nieuwe ${short}`, `Your new ${short}`),
      headline: T(...h),
      teaser: { headline: T(`Haal alles uit {jouw} ${short}`, `Get the most out of your ${short}`), line: T('Een paar dingen om te weten', 'A few things to know') },
    },
    story: { text: T(`${name}${brand && !name.startsWith(brand) ? ` van ${brand}` : ''}. Testmodus: hier komt het merkverhaal uit de bronnen.`, `${name}${brand && !name.startsWith(brand) ? ` by ${brand}` : ''}. Test mode: the brand story from the sources goes here.`), src: src('brand') },
    special: pick(SPECIAL, 2, seed).map(x => tip(x, 'special')),
    expect: pick(EXPECT, s.expectCount, seed).map(x => point(x)),
    fact: { icon: 'tag', text: descFact ? T(`Uit de productbeschrijving: ${descFact.claim.replace(/^From the product description: /, '')}`, descFact.claim) : T(`${name} komt uit de collectie van ${brand || 'deze shop'}.`, `${name} is part of the ${brand || 'shop'} range.`), src: descFact ? [descFact.id] : src('brand') },
    care: pick(CARE, 3, seed).map(x => tip(x, 'care')),
    experience: { question: T('Hoeveel ervaring heb {je} hiermee?', 'How much experience do you have with this?'), new: T('Nieuw voor mij', 'New to me'), regular: T('Ik ken het', 'I know it'), expert: T('Ik weet er veel van', 'I know a lot about it') },
    question: {
      eyebrow: T('Voor {jouw} tips', 'For your tips'), title: T('Hoe vaak ga {je} hem gebruiken?', 'How often will you use it?'), sub: T('Dan passen de tips erbij.', 'So the tips fit.'),
      options: opts.map(([key, ln, le, nn, ne, ok, an, ae], i) => {
        const t = TIPS[(seed + i + 5) % TIPS.length];
        return { key, label: T(ln, le), note: T('', ''), ok, result: { headline: T(nn, ne), lines: [T(an, ae), T('Dit is testinhoud.', 'This is test content.')] },
          tip: { icon: t[0], title: T(t[1], t[2]), text: T(t[3], t[4]), why: T(`Omdat {je} koos: ${ln.toLowerCase()}`, `Because you chose: ${le.toLowerCase()}`) }, src: [] };
      }),
    },
    tips: { new: tips.slice(0, s.tipCount).map(x => tip(x)), regular: tips.slice(s.tipCount, s.tipCount * 2).map(x => tip(x)), expert: tips.slice(s.tipCount * 2).map(x => tip(x)) },
    whileYouWait: { title: T('Terwijl {je} wacht', 'While you wait'), items: pick(SHIPPED, s.emailItems, seed).map(x => point(x)) },
    firstMinutes: { title: T('De eerste 10 minuten', 'The first 10 minutes'), items: pick(DELIVERED, s.emailItems, seed).map(x => point(x)) },
  };
}

export async function write({ page, research: r, settings }) {
  await wait(300);
  const seed = Math.floor(Date.now() / 1000) % 7;
  const content = schemas(settings.languages).Content.parse(build({ page, research: r, settings, seed })); // same shape as the real writer
  return { content, usage: NOUSAGE };
}

// The wish shows up in the rewritten text, so the tool can see the round trip work.
export async function revise({ page, research: r, settings, current, path, wish }) {
  await wait(250);
  const before = JSON.stringify(getPath(current, path));
  const shop = r.facts.find(f => f.id.startsWith('w'));
  for (let seed = 1; seed < 12; seed++) {
    const c = build({ page, research: r, settings, seed: seed + (Date.now() % 5) });
    let piece = structuredClone(getPath(c, path) ?? getPath(current, path));
    if (piece == null) break;
    if (kindOf(path) === 'option') piece.key = getPath(current, path).key;
    if (kindOf(path) === 'question') piece.options = piece.options.map((o, i) => ({ ...o, key: current.question.options[i]?.key ?? o.key }));
    if (wish && piece && typeof piece === 'object') {
      const note = t => Object.fromEntries(Object.entries(t).map(([l, v]) => [l, `${v} (wens: ${wish.slice(0, 60)})`]));
      const field = ['text', 'title', 'headline', 'question'].find(k => piece[k] && typeof piece[k] === 'object' && !Array.isArray(piece[k]) && settings.languages.every(l => typeof piece[k][l] === 'string'));
      if (field) piece[field] = note(piece[field]);
      else if (settings.languages.every(l => typeof piece[l] === 'string')) piece = note(piece);
      if (shop && Array.isArray(piece.src)) piece.src = [...new Set([...piece.src, shop.id])];
    }
    // a tip may not repeat another tip
    const [l] = settings.languages, others = [...(current.care || []), ...Object.values(current.tips || {}).flat()].filter(t => t !== getPath(current, path));
    if (piece?.title?.[l] && others.some(t => t.title?.[l] === piece.title[l].replace(/ \(wens: .*\)$/, ''))) continue;
    if (JSON.stringify(piece) !== before) return { piece, usage: NOUSAGE };
  }
  return { piece: getPath(current, path), usage: NOUSAGE };
}
