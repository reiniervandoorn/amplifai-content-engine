// Test mode: the same three functions as ai.js, without Claude. Everything around them runs for real
// (reading the product page, jobs, settings, the quality check); only the words come from fixed templates.
// The output follows the same schema and the same settings (languages, formality, tone, counts),
// so the AmplifAI tool can be built against it without an Anthropic key and at no cost.
// Dutch and English are written out; German and French reuse the English text with a [DE]/[FR] tag.
import { schemas, getPath, kindOf } from './ai.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const NOUSAGE = { input: 0, output: 0, searches: 0 };

/* ── word lists. {je}/{jouw}/{Je}/{Jouw} become je/jouw or u/uw in Dutch ── */
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
const CARE = [
  ['drop', 'Schoonmaken met een zachte doek', 'Clean with a soft cloth', 'Een vochtige, zachte doek is meestal genoeg. Agressieve middelen zijn zelden nodig.', 'A damp, soft cloth is usually enough. Harsh cleaners are rarely needed.'],
  ['thermo', 'Droog en uit de zon bewaren', 'Store dry and out of the sun', 'Vocht en direct zonlicht verouderen de meeste materialen het snelst.', 'Moisture and direct sunlight age most materials fastest.'],
  ['shield', 'Lees het onderhoudslabel', 'Read the care label', 'Daar staat precies hoe {je} het lang mooi houdt.', 'It says exactly how to keep it in good shape.'],
  ['cal', 'Plan een vast onderhoudsmoment', 'Plan a regular maintenance moment', 'Eén keer per maand even nalopen voorkomt de meeste problemen.', 'Checking it once a month prevents most problems.'],
  ['trash', 'Afscheid nemen', 'When it is time to replace it', 'Kijk bij de gemeente of het merk hoe {je} het goed laat recyclen.', 'Check with your council or the brand how to recycle it properly.'],
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

/* ── turning a Dutch/English pair into the languages and form of address the settings ask for ── */
function texter(s) {
  const formal = s.formality === 'formal';
  const nlForm = t => t.replace(/\{je\}/g, formal ? 'u' : 'je').replace(/\{jouw\}/g, formal ? 'uw' : 'jouw')
    .replace(/\{Je\}/g, formal ? 'U' : 'Je').replace(/\{Jouw\}/g, formal ? 'Uw' : 'Jouw').replace(/\{jou\}/g, formal ? 'u' : 'jou');
  return (nl, en) => Object.fromEntries(s.languages.map(l => [l, l === 'nl' ? nlForm(nl) : l === 'en' || !en ? en : `[${l.toUpperCase()}] ${en}`]));
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
  onProgress?.(page.url ? `Testmodus: leest ${page.url}` : 'Testmodus: leest de productgegevens van de shop'); await wait(250);
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
    facts: claims.map(([category, claim], i) => ({ id: 'f' + (i + 1), category, claim, url: page.url || 'shop:product', title: page.url ? 'Productpagina' : 'Productgegevens van de shop', snippet: '' })),
    dropped: 0,
    questionIdeas: [{ question: 'How often will you use it?', options: ['Every day', 'At weekends', 'Not sure yet'], why: 'Changes the care advice.' }],
    usage: NOUSAGE,
    mock: true,
  };
}

/* ── questions per moment: [question nl, question en, answers [label nl, label en, reply nl, reply en]] ── */
const QUESTIONS = {
  ordered: [
    ['Hoe vaak ga {je} hem gebruiken?', 'How often will you use it?', [
      ['Elke dag', 'Every day', 'Bij dagelijks gebruik loont een vast onderhoudsmoment.', 'With daily use, a regular care moment pays off.'],
      ['In het weekend', 'At weekends', 'Berg het tussendoor droog en schoon op.', 'Store it dry and clean in between.'],
      ['Voor iets speciaals', 'For something special', 'Gebruik het een paar keer vóór het moment zelf.', 'Use it a few times before the moment itself.'],
      ['Af en toe', 'Now and then', '', ''],
      ['Weet ik nog niet', 'Not sure yet', 'Begin met korte momenten en kijk wat bevalt.', 'Start with short moments and see what you like.']]],
    ['Hoeveel ervaring heb {je} hiermee?', 'How much experience do you have with this?', [
      ['Nieuw voor mij', 'New to me', 'Dan helpen de tips hieronder {je} rustig op weg.', 'Then the tips below help you get started calmly.'],
      ['Ik ken het', 'I know it', '', ''],
      ['Ik weet er veel van', 'I know a lot about it', 'Dan zijn de details hieronder vooral voor {jou}.', 'Then the details below are mostly for you.'],
      ['Ik had er al een', 'I had one before', 'Let op de verschillen met {jouw} vorige.', 'Look out for the differences with your previous one.'],
      ['Zeg ik liever niet', 'Rather not say', '', '']]],
    ['Waarvoor is hij vooral?', 'What is it mainly for?', [
      ['Voor mezelf', 'For myself', '', ''],
      ['Een cadeau', 'A present', 'Bewaar de bon apart van het cadeau.', 'Keep the receipt apart from the present.'],
      ['Voor het werk', 'For work', '', ''],
      ['Voor de sport', 'For sport', '', ''],
      ['Nog niet zeker', 'Not sure yet', '', '']]],
  ],
  in_transit: [
    ['Weet {je} al waar hij komt?', 'Do you know where it will go?', [
      ['Ja', 'Yes', 'Mooi, dan kan {je} hem meteen een plek geven.', 'Good, then you can give it a spot straight away.'],
      ['Nog niet', 'Not yet', 'Kies een droge plek uit de zon.', 'Pick a dry spot out of the sun.'],
      ['Ik twijfel', 'I am not sure', '', ''],
      ['Hij gaat mee op pad', 'It travels with me', 'Een vaste tas of hoes houdt hem netjes.', 'A fixed bag or cover keeps it tidy.'],
      ['Maakt niet uit', 'Does not matter', '', '']]],
    ['Wil {je} vooraf de handleiding lezen?', 'Do you want to read the manual first?', [
      ['Ja, graag', 'Yes, please', 'Vaak staat hij ook online bij het merk.', 'It is often online at the brand too.'],
      ['Liever niet', 'Rather not', 'Geen probleem: de bezorgmail zet de eerste stappen op een rij.', 'No problem: the delivery email lists the first steps.'],
      ['Misschien', 'Maybe', '', ''],
      ['Heb ik al gedaan', 'Already did', '', ''],
      ['Weet ik niet', 'Not sure', '', '']]],
    ['Heb {je} alles in huis om te beginnen?', 'Do you have everything to get started?', [
      ['Ja', 'Yes', '', ''], ['Ik denk het', 'I think so', '', ''], ['Nee', 'No', 'Kijk in de productbeschrijving wat erbij zit.', 'Check the product description for what is included.'],
      ['Geen idee', 'No idea', '', ''], ['Weet ik niet', 'Not sure', '', '']]],
  ],
  delivered: [
    ['Is alles compleet aangekomen?', 'Did everything arrive complete?', [
      ['Ja', 'Yes', 'Fijn. Bewaar de verpakking nog even.', 'Good. Keep the packaging for a while.'],
      ['Er mist iets', 'Something is missing', 'Neem contact op met de shop: die helpt graag.', 'Contact the shop: they are happy to help.'],
      ['Nog niet bekeken', 'Not checked yet', '', ''],
      ['Er is iets beschadigd', 'Something is damaged', 'Maak een foto en meld het bij de shop.', 'Take a photo and tell the shop.'],
      ['Weet ik niet', 'Not sure', '', '']]],
    ['Hoe voelt het de eerste keer?', 'How does it feel the first time?', [
      ['Goed', 'Good', '', ''], ['Even wennen', 'Takes getting used to', 'Dat is normaal: geef het een paar keer gebruik.', 'That is normal: give it a few uses.'],
      ['Anders dan verwacht', 'Different than expected', 'Kijk of {je} iets kunt afstellen.', 'See whether you can adjust something.'],
      ['Nog niet geprobeerd', 'Not tried yet', '', ''], ['Weet ik niet', 'Not sure', '', '']]],
    ['Wil {je} weten hoe {je} hem onderhoudt?', 'Do you want to know how to look after it?', [
      ['Ja', 'Yes', 'De tips hieronder gaan daarover.', 'The tips below are about that.'], ['Later', 'Later', '', ''],
      ['Ik weet het al', 'I already know', '', ''], ['Misschien', 'Maybe', '', ''], ['Weet ik niet', 'Not sure', '', '']]],
  ],
};
const INTRO = {
  ordered: (name, brand) => [`${name}${brand && !name.startsWith(brand) ? ` van ${brand}` : ''}. Testmodus: hier komt het merkverhaal uit de bronnen, en waarom hij bij {jou} past.`, `${name}${brand && !name.startsWith(brand) ? ` by ${brand}` : ''}. Test mode: the brand story from the sources goes here, and why it suits you.`],
  in_transit: () => ['{Je} pakket is onderweg. Een paar dingen om alvast klaar te zetten.', 'Your parcel is on its way. A few things to get ready.'],
  delivered: () => ['Hij is er. De eerste vijf minuten, en wat normaal is.', 'It has arrived. The first five minutes, and what is normal.'],
};
// tips per moment from the word lists: [title nl, title en, text nl, text en]
const asTip = ([, tn, te, dn, de]) => [tn, te, dn, de];
const TIP_SETS = {
  ordered: TIPS.map(asTip),
  in_transit: [...SHIPPED.map(asTip),
    ['Laad alvast op wat moet laden', 'Charge what needs charging', 'Batterijen en accu’s zijn bij aankomst vaak maar half vol.', 'Batteries often arrive only half full.'],
    ['Maak een plekje vrij', 'Clear a space', 'Uitpakken gaat makkelijker op een vrije tafel.', 'Unpacking is easier on a clear table.']],
  delivered: [...DELIVERED.map(asTip), ...EXPECT.map(asTip), ...CARE.map(asTip)],
};

/* ── writing ── */
function build({ page, research: r, settings: s, seed = 0 }) {
  const T = texter(s);
  const fid = cat => r.facts.find(f => f.category === cat)?.id;
  const src = cat => (fid(cat) ? [fid(cat)] : []);
  const name = page.name || 'product', brand = page.brand || '';
  const guide = m => {
    const qs = pick(QUESTIONS[m], s.questionCount, seed % QUESTIONS[m].length);
    return {
      intro: { text: T(...INTRO[m](name, brand)), src: m === 'ordered' ? [...src('shop'), ...src('brand')] : [] },
      questions: qs.map(([qn, qe, answers], i) => ({
        question: T(qn, qe),
        answers: [...answers.slice(0, s.answerCount - 1), answers[answers.length - 1]].map(([ln, le, rn, re], j, all) => ({
          label: T(ln, le), reply: T(rn, re),
          // the second answer of the first question skips straight to the tips, so the flow has a branch
          next: i === 0 && j === 1 && qs.length > 1 ? 'end' : 'next',
          src: [],
        })),
      })),
      tips: pick(TIP_SETS[m], s.tipCount, seed).map(([tn, te, dn, de], i) => ({ text: T(`${tn.replace(/\.$/, '')}. ${dn}`, `${te.replace(/\.$/, '')}. ${de}`), src: m === 'delivered' && i === 0 ? src('care') : [] })),
    };
  };
  return { ordered: guide('ordered'), in_transit: guide('in_transit'), delivered: guide('delivered') };
}

export async function write({ page, research: r, settings }) {
  await wait(300);
  const seed = Math.floor(Date.now() / 1000) % 7;
  const content = schemas(settings.languages).Content.parse(build({ page, research: r, settings, seed })); // same shape as the real writer
  return { content, usage: NOUSAGE };
}

// The wish shows up in the rewritten text, so the tool can see the round trip work.
// `current` is in Claude's form (next as "next", "end" or an index), like the real writer gets it.
export async function revise({ page, research: r, settings, current, path, wish }) {
  await wait(250);
  const kind = kindOf(path), now = getPath(current, path), before = JSON.stringify(now);
  const shop = r.facts.find(f => f.id.startsWith('w'));
  const note = t => Object.fromEntries(Object.entries(t).map(([l, v]) => [l, v ? `${v} (wens: ${wish.slice(0, 60)})` : v]));
  for (let seed = 1; seed < 12; seed++) {
    const counts = kind === 'moment' ? { questionCount: now.questions.length, tipCount: now.tips.length } : {};
    let piece = structuredClone(getPath(build({ page, research: r, settings: { ...settings, ...counts }, seed: seed + (Date.now() % 5) }), path) ?? now);
    if (kind === 'question') piece.answers = now.answers.map((a, j) => ({ ...(piece.answers[j] || a), next: a.next }));
    if (kind === 'answer') piece.next = now.next;
    if (wish) {
      if (piece.text) piece.text = note(piece.text);
      else if (piece.intro) piece.intro.text = note(piece.intro.text);
      else if (piece.question) piece.question = note(piece.question);
      else if (piece.label) piece.label = note(piece.label);
      const target = piece.src ? piece : piece.intro || piece.answers?.[0];
      if (shop && target?.src) target.src = [...new Set([...target.src, shop.id])];
    }
    if (JSON.stringify(piece) !== before) return { piece, usage: NOUSAGE };
  }
  return { piece: now, usage: NOUSAGE };
}
