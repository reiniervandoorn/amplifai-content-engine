// The made-up demo shop: running, cycling and triathlon. Brands and sources are invented (.test domains),
// so no real shop or brand is shown. Three products have a finished guide; the rest are for "alles klaarzetten".
import { readFileSync } from 'node:fs';

const B = (nl, en) => ({ nl, en });
const tip = (icon, tn, te, dn, de, src = []) => ({ icon, title: B(tn, te), text: B(dn, de), src });
const ex = (ln, le, tn, te, src = []) => ({ lead: B(ln, le), text: B(tn, te), src });
const it = (icon, ln, le, tn, te, src = []) => ({ icon, lead: B(ln, le), text: B(tn, te), src });
const opt = (v, ln, le, ok, hn, he, l1n, l1e, l2n, l2e, src = [], nn = '', ne = '') => ({ v, label: B(ln, le), note: B(nn, ne), ok, h: B(hn, he), lines: [B(l1n, l1e), B(l2n, l2e)], src });
const atip = (v, icon, tn, te, dn, de, wn, we, src = []) => ({ v, icon, title: B(tn, te), text: B(dn, de), why: B(wn, we), src });

export const SHOP = { name: 'Kilometerwinkel', domain: 'kilometerwinkel.test', accent: '#0F6B5C' };
const U = p => `https://kilometerwinkel.test/products/${p}`;

// a simple drawn tile per product, so lists and previews are not empty
const ICON = {
  walk: '<circle cx="13.5" cy="4.5" r="1.6"/><path d="M10 21l2-6 3 2v4"/><path d="M8 11l3-3 3 1 2 3 2 1"/><path d="M12 15l-1-4"/>',
  route: '<circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="5.5" r="2"/><path d="M8 18.5h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6z"/>',
  gauge: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 14l3.5-4"/><circle cx="12" cy="14" r="1.2"/>',
  drop: '<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4l2.5 1.5"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 15h14a3 3 0 1 1-3 3"/>',
  swap: '<path d="M7 4L3.5 7.5 7 11"/><path d="M3.5 7.5H17"/><path d="M17 13l3.5 3.5L17 20"/><path d="M20.5 16.5H7"/>',
  cup: '<path d="M5 8h12v5a6 6 0 0 1-12 0z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/>',
  sock: '<path d="M8 3.5h7v8.5l3.5 3.5a3.2 3.2 0 0 1-4.5 4.5L9 14.5a3.5 3.5 0 0 1-1-2.5z"/>',
  thermo: '<path d="M10 13.6V5a2 2 0 0 1 4 0v8.6a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>',
  tool: '<path d="M14.5 5.5a4.2 4.2 0 0 0 5 5l-8.3 8.3a2.1 2.1 0 0 1-3-3z"/>',
  volume: '<path d="M4 9.5v5h3.5l4.5 4V5.5l-4.5 4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  plug: '<path d="M9 3.5v5M15 3.5v5"/><path d="M6.5 8.5h11V12a5.5 5.5 0 0 1-11 0z"/><path d="M12 17.5v3"/>',
  scale: '<rect x="3.5" y="9" width="17" height="10.5" rx="2.5"/><path d="M8 9V6.5a4 4 0 0 1 8 0V9"/><path d="M12 12.5v2.5"/>',
  steam: '<path d="M8 20c0-2.5 2.5-3 2.5-5.5S8 11.5 8 9"/><path d="M13.5 20c0-2.5 2.5-3 2.5-5.5S13.5 11.5 13.5 9"/><path d="M6 5h12"/>',
  tvi: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/>',
};
export const tile = (icon, brand, bg) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${bg}"/>` +
  `<g transform="translate(140 60) scale(5)" fill="none" stroke="#1d2b28" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICON[icon]}</g>` +
  `<text x="200" y="262" text-anchor="middle" font-family="-apple-system,Helvetica,Arial" font-size="22" font-weight="700" letter-spacing="4" fill="#1d2b28" opacity=".55">${brand.toUpperCase()}</text></svg>`);

const page = (slug, name, brand, price, category, description, variants, icon, bg) =>
  ({ url: U(slug), name, brand, price, category, description, variants, properties: [], image: tile(icon, brand, bg), pageText: description });

export const PAGES = [
  page('noordwand-kompas-trail-2', 'Noordwand Kompas Trail 2', 'Noordwand', '€149,95', 'Trailschoenen', 'Trailschoen met 5 mm noppen en een flexibele rotsplaat, voor bos, duin en berg.', ['EU 40', 'EU 41', 'EU 42', 'EU 43', 'EU 44', 'EU 45'], 'walk', '#E4EEE6'),
  page('duno-dt1-smart-trainer', 'Duno DT-1 Smart Trainer', 'Duno', '€649,00', 'Fietstrainers', 'Direct-drive smart trainer met vermogensmeting tot op 2%, maximaal 2.000 watt weerstand en ondersteuning voor de bekende trainingsapps. Geleverd zonder cassette.', ['Zonder cassette'], 'gauge', '#E6E9F2'),
  page('golfslag-tri-wetsuit', 'Golfslag Tri Wetsuit 4/3', 'Golfslag', '€379,00', 'Wetsuits', 'Triathlonwetsuit met 4 mm neopreen op romp en benen voor drijfvermogen, en 3 mm op de schouders voor bewegingsvrijheid. Met snelle-wissel ritssluiting.', ['Heren M', 'Heren L', 'Dames S', 'Dames M'], 'drop', '#E2EDF3'),
  page('ritmo-tempo-3', 'Ritmo Tempo 3', 'Ritmo', '€159,95', 'Hardloopschoenen', 'Lichte hardloopschoen voor tempotrainingen en wedstrijden tot de halve marathon, met een verende tussenzool.', ['EU 39', 'EU 40', 'EU 41', 'EU 42', 'EU 43', 'EU 44'], 'route', '#F2EADF'),
  page('veloce-aero-helm', 'Veloce Aero Racehelm', 'Veloce', '€189,00', 'Fietshelmen', 'Aerodynamische racefietshelm met zes ventilatieopeningen en een verstelbaar draaiwiel achterop.', ['S', 'M', 'L'], 'shield', '#EEE6F0'),
  page('pulsar-5-gps-horloge', 'Pulsar 5 GPS-sporthorloge', 'Pulsar', '€299,00', 'Sporthorloges', 'GPS-sporthorloge voor hardlopen, fietsen en zwemmen, met multisportmodus voor triathlon en tot 30 uur batterij met GPS aan.', ['Zwart', 'Wit'], 'clock', '#E9ECEF'),
  page('helder-pro-fietsbril', 'Helder Pro Fietsbril', 'Helder', '€119,00', 'Sportbrillen', 'Fotochrome fietsbril die van helder naar donker kleurt, met ventilatie tegen beslaan.', ['Mat zwart'], 'wind', '#EDEFE2'),
  page('overgang-trisuit', 'Overgang Trisuit', 'Overgang', '€169,00', 'Triathlonkleding', 'Eendelig triathlonpak voor zwemmen, fietsen en lopen, met dun zeemlapje en ritssluiting voor.', ['S', 'M', 'L', 'XL'], 'swap', '#E2F0EE'),
  page('brandstof-gel-12', 'Brandstof Energiegel 12-pack', 'Brandstof', '€24,95', 'Sportvoeding', 'Twaalf energiegels met elk 25 gram koolhydraten, in de smaken citroen en framboos.', ['Gemengd'], 'cup', '#F3E9E2'),
  page('stap-merino-loopsok', 'Stap Merino Loopsok', 'Stap', '€19,95', 'Hardloopsokken', 'Hardloopsok van merinowol met naadloze teen en extra demping onder de hiel.', ['35-38', '39-42', '43-46'], 'sock', '#EFEAE4'),
];

const kompas = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));

const trainer = {
  research: { product: { brand: 'Duno', name: 'DT-1 Smart Trainer' }, dropped: 2, questionIdeas: [], facts: [
    { id: 'f1', category: 'brand', claim: 'Duno started in 2009 in Eindhoven as a workshop building trainers for track cyclists.', url: 'https://duno.test/over-duno', title: 'Over Duno', on: true },
    { id: 'f2', category: 'special', claim: 'The DT-1 measures power to within 2% and can hold up to 2,000 watts of resistance.', url: U('duno-dt1-smart-trainer'), title: 'Productpagina', on: true },
    { id: 'f3', category: 'compat', claim: 'The DT-1 ships without a cassette; it fits 11- and 12-speed Shimano road cassettes out of the box.', url: 'https://duno.test/support/cassette', title: 'Welke cassette past?', on: true },
    { id: 'f4', category: 'first_use', claim: 'On first connection the trainer installs a firmware update, which takes a few minutes.', url: 'https://duno.test/support/eerste-start', title: 'Eerste keer opstarten', on: true },
    { id: 'f5', category: 'general', claim: 'At 200 watts the body produces roughly 800 watts of heat.', url: 'https://onderzoek.test/warmte-inspanning', title: 'Warmte bij inspanning (onderzoek)', on: true },
    { id: 'f6', category: 'care', claim: 'Duno advises wiping sweat off the trainer after every session, as salt corrodes the housing.', url: 'https://duno.test/support/onderhoud', title: 'Onderhoud', on: true },
  ] },
  guide: {
    short: B('DT-1', 'DT-1'), title: B('Je nieuwe DT-1', 'Your new DT-1'),
    card: { h: B('Haal alles uit je DT-1', 'Get the most out of your DT-1'), s: B('Klaar om te fietsen op de dag dat hij komt', 'Ready to ride the day it arrives') },
    hook: B('Tegenwind bestaat vanaf nu niet meer.', 'Headwind is now a thing of the past.'),
    story: { text: B('Duno begon in 2009 in Eindhoven met trainers voor baanrenners. De DT-1 meet je vermogen tot op 2% en houdt tot 2.000 watt tegen.', 'Duno started in 2009 in Eindhoven, building trainers for track cyclists. The DT-1 measures your power to within 2% and holds up to 2,000 watts.'), src: ['f1', 'f2'] },
    expect: [ex('De eerste keer: even updaten.', 'First time: a quick update.', 'Bij de eerste verbinding installeert hij nieuwe software. Reken op een paar minuten, dus niet vlak voor je eerste training.', 'On first connection it installs new software. Allow a few minutes, so not right before your first workout.', ['f4']),
      ex('Binnen voelt een uur langer.', 'An hour feels longer indoors.', 'Geen afdalingen of stoplichten om even uit te rusten: je trapt elke seconde. Begin met kortere ritten.', 'No descents or traffic lights to rest on: you pedal every second. Start with shorter rides.')],
    fact: { icon: 'thermo', text: B('Bij 200 watt maakt je lichaam zo’n 800 watt warmte, zoveel als een klein kacheltje. Een ventilator scheelt dus veel.', 'At 200 watts your body makes about 800 watts of heat, as much as a small heater. A fan makes a big difference.'), src: ['f5'] },
    lq: { q: B('Heb je eerder binnen gefietst?', 'Have you ridden indoors before?'), new: B('Mijn eerste trainer', 'My first trainer'), reg: B('Een paar winters', 'A few winters'), pro: B('Ik train op vermogen', 'I train with power') },
    q: { eye: B('Snelle check', 'Quick check'), title: B('Welke groep zit op je fiets?', 'Which groupset is on your bike?'), sub: B('Zodat je meteen kunt fietsen als hij er is.', 'So you can ride the day it arrives.'), options: [
      opt('shimano', 'Shimano 11/12-speed', 'Shimano 11/12-speed', true, 'Past op de body in de doos', 'Fits the freehub in the box', 'Een Shimano-racecassette schuift er zo op.', 'A Shimano road cassette slides straight on.', 'Kies dezelfde range als op je fiets, dan voelt alles vertrouwd.', 'Pick the same range as on your bike so everything feels familiar.', ['f3']),
      opt('sram', 'SRAM 12-speed', 'SRAM 12-speed', false, 'Check dit vandaag al', 'Check this today', 'SRAM 12-speed heeft een andere freehub-body nodig.', 'SRAM 12-speed needs a different freehub body.', 'Bestel body en cassette samen, dan wacht je maar één keer.', 'Order body and cassette together so you only wait once.', ['f3']),
      opt('campa', 'Campagnolo', 'Campagnolo', false, 'Campagnolo heeft een eigen body nodig', 'Campagnolo needs its own body', 'Een Campagnolo-cassette past niet op de standaard body.', 'A Campagnolo cassette does not fit the standard body.', 'Bewaar de originele body, handig als je ooit wisselt.', 'Keep the original body, handy if you ever switch.', ['f3']),
      opt('unsure', 'Weet ik niet zeker', 'Not sure', false, 'Twee dingen bepalen of hij past', 'Two things decide whether it fits', 'Tel de tandwielen achter en kijk welk merk op de lockring staat.', 'Count the rear sprockets and check the brand on the lockring.', 'Twijfel je nog? Stuur de shop een foto van je achterwiel.', 'Still unsure? Send the shop a photo of your rear wheel.')] },
    tips: {
      new: [tip('wind', 'Ventilator aan vóór je begint', 'Fan on before you start', 'Hitte stopt meer binnensessies dan vermoeide benen. Richt hem vanaf minuut één op je borst.', 'Heat ends more indoor sessions than tired legs. Aim it at your chest from minute one.', ['f5']),
        tip('clock', 'Begin met 45 minuten', 'Start with 45 minutes', 'Binnen trap je zonder pauzes. Bouw rustig op naar langere ritten.', 'Indoors you pedal without breaks. Build up to longer rides calmly.'),
        tip('drop', 'Handdoek over het stuur', 'Towel over the bars', 'Zweet valt op je balhoofd en stuur. Een handdoek voorkomt roest.', 'Sweat drips onto your headset and bars. A towel prevents rust.')],
      reg: [tip('tool', 'Veeg hem na elke rit af', 'Wipe it after every ride', 'Zout uit zweet tast de behuizing aan. Even afvegen houdt hem mooi.', 'Salt from sweat attacks the housing. A quick wipe keeps it in shape.', ['f6']),
        tip('volume', 'Het geluid is je ketting', 'The noise is your chain', 'Het meeste geluid komt van de aandrijving. Een schone ketting in een middelste versnelling is bijna stil.', 'Most noise comes from the drivetrain. A clean chain in a middle gear is almost silent.'),
        tip('clock', 'Elke tien minuten even staan', 'Stand up every ten minutes', 'Binnen verschuif je nauwelijks op het zadel. Twintig seconden staan voorkomt zadelpijn.', 'Indoors you barely shift on the saddle. Twenty seconds standing prevents saddle sores.')],
      pro: [tip('gauge', 'Kalibreer na het opwarmen', 'Calibrate after warming up', 'Een warme trainer meet het nauwkeurigst. Doe de kalibratie na tien minuten fietsen.', 'A warm trainer measures most accurately. Calibrate after ten minutes of riding.', ['f2']),
        tip('swap', 'Gebruik één vermogensbron', 'Use one power source', 'Fiets je ook met een vermogensmeter? Kies er één in je app, dan kloppen je zones.', 'Do you also ride with a power meter? Pick one in your app so your zones match.'),
        tip('thermo', 'Je hartslag ligt binnen hoger', 'Your heart rate runs higher indoors', 'Zonder koelende wind kost hetzelfde vermogen meer. Dat is warmte, geen verloren conditie.', 'Without cooling wind the same power costs more. That is heat, not lost fitness.', ['f5'])] },
    answerTips: [
      atip('shimano', 'tool', 'Tikt hij na het monteren?', 'Clicking after fitting?', 'Een kwartslag aan de stelschroef bij je derailleur maakt hem stil.', 'A quarter turn of the barrel adjuster at the derailleur makes it quiet.', 'Omdat je Shimano rijdt', 'Because you ride Shimano'),
      atip('sram', 'tool', 'Waarom SRAM een eigen body nodig heeft', 'Why SRAM needs its own body', 'De kleinste tandwielen van SRAM 12-speed passen alleen op een andere body. Bestel ze samen.', 'The smallest SRAM 12-speed sprockets only fit a different body. Order them together.', 'Omdat je SRAM 12-speed rijdt', 'Because you ride SRAM 12-speed', ['f3']),
      atip('campa', 'tool', 'Bewaar de originele body', 'Keep the original body', 'Handig als je de trainer later met een andere fiets gebruikt.', 'Handy if you later use the trainer with another bike.', 'Omdat je Campagnolo rijdt', 'Because you ride Campagnolo'),
      atip('unsure', 'phone', 'Een foto zegt genoeg', 'A photo says enough', 'Een foto van je achterwiel van dichtbij is voor de shop genoeg om te zien wat past.', 'A close-up photo of your rear wheel is enough for the shop to see what fits.', 'Omdat je twijfelt over je groep', 'Because you are unsure about your groupset')],
    shipped: { title: B('Terwijl je wacht', 'While you wait'), items: [
      it('tool', 'Regel de cassette.', 'Sort out the cassette.', 'De DT-1 komt zonder cassette. Zorg dat je er een hebt als hij binnenkomt.', 'The DT-1 comes without a cassette. Make sure you have one when it arrives.', ['f3']),
      it('plug', 'Kies een plek bij een stopcontact.', 'Pick a spot near a socket.', 'Harde vloer, stopcontact dichtbij en ruimte voor een ventilator.', 'Hard floor, a socket nearby and room for a fan.'),
      it('phone', 'Zet je app klaar.', 'Get your app ready.', 'Log alvast in, dan ben je bij de eerste rit sneller klaar.', 'Log in now so you are ready faster on your first ride.')] },
    delivered: { title: B('De eerste 10 minuten', 'The first 10 minutes'), items: [
      it('plug', 'Eerst de stroom erop.', 'Power first.', 'Zonder stroom geen weerstand, en ook geen verbinding met je app.', 'No power means no resistance, and no connection to your app.'),
      it('phone', 'Laat hem updaten.', 'Let it update.', 'De eerste verbinding installeert nieuwe software. Even geduld.', 'The first connection installs new software. A little patience.', ['f4']),
      it('box', 'Bewaar de doos nog even.', 'Keep the box for now.', 'Handig als je hem wilt ruilen of ooit wilt vervoeren.', 'Handy if you want to exchange it or move it some day.')] },
  },
};

const wetsuit = {
  research: { product: { brand: 'Golfslag', name: 'Tri Wetsuit 4/3' }, dropped: 1, questionIdeas: [], facts: [
    { id: 'f1', category: 'brand', claim: 'Golfslag was founded in 2004 by open-water swimmers in Hoorn.', url: 'https://golfslag.test/verhaal', title: 'Ons verhaal', on: true },
    { id: 'f2', category: 'special', claim: 'The suit uses 4 mm neoprene on torso and legs for buoyancy and 3 mm on the shoulders for freedom of movement.', url: U('golfslag-tri-wetsuit'), title: 'Productpagina', on: true },
    { id: 'f3', category: 'care', claim: 'Golfslag advises rinsing the suit in fresh water after every swim and drying it inside out, out of the sun.', url: 'https://golfslag.test/onderhoud', title: 'Onderhoud van je wetsuit', on: true },
    { id: 'f4', category: 'first_use', claim: 'Fingernails are the main cause of small cuts in neoprene; Golfslag recommends putting the suit on with cotton gloves or the pads of the fingers.', url: 'https://golfslag.test/aantrekken', title: 'Zo trek je hem aan', on: true },
    { id: 'f5', category: 'general', claim: 'Most triathlon rules allow wetsuits when the water is below 24.5 °C for age-group athletes.', url: 'https://triathlonbond.test/reglement', title: 'Wedstrijdreglement', on: true },
  ] },
  guide: {
    short: B('Tri Wetsuit', 'Tri Wetsuit'), title: B('Je nieuwe wetsuit', 'Your new wetsuit'),
    card: { h: B('Haal alles uit je wetsuit', 'Get the most out of your wetsuit'), s: B('Drie dingen vóór je eerste zwemsessie', 'Three things before your first swim') },
    hook: B('Strak is precies goed.', 'Tight is exactly right.'),
    story: { text: B('Golfslag begon in 2004 bij openwaterzwemmers in Hoorn. Dikker neopreen op romp en benen laat je hoger drijven, dunner op de schouders laat je vrij bewegen.', 'Golfslag started in 2004 with open-water swimmers in Hoorn. Thicker neoprene on torso and legs keeps you higher in the water; thinner on the shoulders lets you move freely.'), src: ['f1', 'f2'] },
    expect: [ex('Op het droge voelt hij te strak.', 'On dry land it feels too tight.', 'In het water ontspant het neopreen en zit hij goed. Zo hoort het.', 'In the water the neoprene relaxes and it fits well. That is how it should be.'),
      ex('Je ligt hoger in het water.', 'You float higher.', 'Je benen zakken minder weg, dus je slag voelt anders. Geef het een paar sessies.', 'Your legs sink less, so your stroke feels different. Give it a few sessions.', ['f2'])],
    fact: { icon: 'thermo', text: B('Bij de meeste triathlons mogen deelnemers een wetsuit dragen als het water kouder is dan 24,5 °C.', 'At most triathlons, participants may wear a wetsuit when the water is colder than 24.5 °C.'), src: ['f5'] },
    lq: { q: B('Hoe vaak zwem je in open water?', 'How often do you swim in open water?'), new: B('Nog nooit', 'Never yet'), reg: B('Een paar keer per jaar', 'A few times a year'), pro: B('Elke week in het seizoen', 'Weekly in season') },
    q: { eye: B('Voor jouw tips', 'For your tips'), title: B('Waar ga je hem dragen?', 'Where will you wear it?'), sub: B('Dan passen de tips bij jouw water.', 'So the tips match your water.'), options: [
      opt('race', 'Een triathlon', 'A triathlon', true, 'Oefen de wissel', 'Practise the change', 'Uittrekken onder tijdsdruk is een vaardigheid. Oefen het een paar keer.', 'Getting out of it under time pressure is a skill. Practise it a few times.', 'Kijk vooraf in het reglement tot welke watertemperatuur een wetsuit mag.', 'Check the rules for the water temperature up to which a wetsuit is allowed.', ['f5']),
      opt('lake', 'Recreatief in een meer', 'Leisure in a lake', true, 'Lekker drijven', 'Easy floating', 'Je drijft hoger, dus langere afstanden voelen rustiger.', 'You float higher, so longer distances feel calmer.', 'Zwem met een felgekleurde badmuts, dan zien anderen je.', 'Swim with a brightly coloured cap so others can see you.'),
      opt('sea', 'In zee', 'In the sea', false, 'Spoel hem na elke keer', 'Rinse it every time', 'Zout en zand slijten neopreen snel.', 'Salt and sand wear neoprene fast.', 'Spoel hem met zoet water, ook als je moe bent.', 'Rinse it in fresh water, even when you are tired.', ['f3']),
      opt('unsure', 'Weet ik nog niet', 'Not sure yet', true, 'Begin in een zwembad of rustig meer', 'Start in a pool or calm lake', 'Zo went je aan het drijven zonder golven.', 'That way you get used to floating without waves.', 'Zwem de eerste keer kort, met iemand in de buurt.', 'Swim briefly the first time, with someone nearby.')] },
    tips: {
      new: [tip('shield', 'Aantrekken met je vingertoppen', 'Put it on with your fingertips', 'Nagels veroorzaken de meeste sneetjes in neopreen. Trek hem op met de toppen van je vingers.', 'Nails cause most cuts in neoprene. Pull it up with the pads of your fingers.', ['f4']),
        tip('clock', 'Neem de tijd bij het aantrekken', 'Take your time putting it on', 'Begin bij je enkels en werk omhoog. Zit hij goed in je kruis, dan bewegen je schouders vrij.', 'Start at your ankles and work up. When it sits right at the crotch, your shoulders move freely.'),
        tip('drop', 'Even water erin laten lopen', 'Let a little water in', 'Trek bij het instappen de kraag even open. Een dun laagje water maakt hem comfortabeler.', 'Pull the collar open briefly as you get in. A thin layer of water makes it more comfortable.')],
      reg: [tip('thermo', 'Binnenstebuiten drogen, uit de zon', 'Dry inside out, out of the sun', 'Zon en hitte maken neopreen hard. Laat hem in de schaduw drogen.', 'Sun and heat harden neoprene. Let it dry in the shade.', ['f3']),
        tip('home', 'Op een brede hanger', 'On a wide hanger', 'Een dunne hanger maakt een vouw in de schouders. Een brede houdt hem in vorm.', 'A thin hanger creases the shoulders. A wide one keeps its shape.'),
        tip('tool', 'Smeer je nek', 'Grease your neck', 'Een beetje anti-schuurmiddel in je nek voorkomt een rode plek na lange afstanden.', 'A little anti-chafe on your neck prevents a red mark after long swims.')],
      pro: [tip('swap', 'Oefen de wissel', 'Practise the transition', 'Rits open tijdens het uitlopen, armen eruit, en de rest bij je fiets. Elke seconde telt.', 'Unzip while running out, arms out, the rest at your bike. Every second counts.'),
        tip('gauge', 'Zwem een keer zonder', 'Swim once without', 'Zo merk je hoeveel het drijfvermogen je benen helpt, en pas je je beenslag aan.', 'That way you notice how much the buoyancy helps your legs, and adjust your kick.', ['f2']),
        tip('cal', 'Check het reglement', 'Check the rules', 'Bij warm water kan een wetsuit verboden zijn. Kijk het vooraf na.', 'In warm water a wetsuit may be banned. Check beforehand.', ['f5'])] },
    answerTips: [
      atip('race', 'swap', 'Rits open bij het uitlopen', 'Unzip as you run out', 'Zo heb je je armen al vrij voor je bij je fiets bent.', 'That way your arms are free before you reach your bike.', 'Omdat je een triathlon doet', 'Because you are doing a triathlon'),
      atip('lake', 'drop', 'Badmuts in een felle kleur', 'A brightly coloured cap', 'Zo zien boten en andere zwemmers je van ver.', 'Boats and other swimmers can see you from afar.', 'Omdat je in een meer zwemt', 'Because you swim in a lake'),
      atip('sea', 'drop', 'Spoelen is onderhoud', 'Rinsing is maintenance', 'Zout dat opdroogt maakt neopreen stug. Zoet water erover en hij blijft soepel.', 'Salt that dries makes neoprene stiff. Fresh water keeps it supple.', 'Omdat je in zee zwemt', 'Because you swim in the sea', ['f3']),
      atip('unsure', 'walk', 'Probeer hem eerst thuis', 'Try it at home first', 'Een keer aantrekken in de woonkamer laat zien hoe hij zit, en houdt hem schoon als je wilt ruilen.', 'Putting it on once in the living room shows the fit, and keeps it clean if you want to exchange it.', 'Omdat je nog aan het ontdekken bent', 'Because you are still exploring')],
    shipped: { title: B('Terwijl je wacht', 'While you wait'), items: [
      it('cal', 'Plan een eerste zwemsessie.', 'Plan a first swim.', 'Liefst in rustig water, met iemand in de buurt.', 'Ideally in calm water, with someone nearby.'),
      it('home', 'Zoek een brede hanger.', 'Find a wide hanger.', 'Daar droogt hij straks het best op.', 'That is where it will dry best.'),
      it('tool', 'Leg anti-schuurmiddel klaar.', 'Have anti-chafe ready.', 'Voor je nek, waar de kraag het meest beweegt.', 'For your neck, where the collar moves most.')] },
    delivered: { title: B('De eerste 10 minuten', 'The first 10 minutes'), items: [
      it('walk', 'Pas hem binnen.', 'Try it on indoors.', 'Zo zie je hoe hij zit, en blijft hij schoon als je wilt ruilen.', 'You see the fit, and it stays clean if you want to exchange it.'),
      it('shield', 'Gebruik je vingertoppen.', 'Use your fingertips.', 'Geen nagels: die maken de meeste sneetjes.', 'No nails: they cause most cuts.', ['f4']),
      it('box', 'Bewaar de tas.', 'Keep the bag.', 'Handig om hem nat mee te nemen na het zwemmen.', 'Handy for carrying it wet after a swim.')] },
  },
};

export const GUIDES = {
  [U('noordwand-kompas-trail-2')]: { research: kompas.research, guide: kompas.guide },
  [U('duno-dt1-smart-trainer')]: trainer,
  [U('golfslag-tri-wetsuit')]: wetsuit,
};
