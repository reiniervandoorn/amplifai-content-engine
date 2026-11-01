// More made-up test stores, so the studio can be tried on different kinds of shops. Brands, products
// and domains (.test) are invented. These start empty: "Zet alle producten klaar" writes their guides.
import { tile } from './sample-shop.js';

const shop = (id, name, accent, products) => ({ id, name, domain: `${id}.test`, accent,
  pages: products.map(([slug, name, brand, price, category, description, variants, icon, bg]) =>
    ({ url: `https://${id}.test/products/${slug}`, name, brand, price, category, description, variants, properties: [], image: tile(icon, brand, bg), pageText: description })) });

export const SHOPS = [
  shop('bonenbar', 'Bonenbar', '#7A4A26', [
    ['rivolta-duo', 'Rivolta Duo Espressomachine', 'Rivolta', '€749,00', 'Espressomachines', 'Espressomachine met dubbele boiler, zodat je tegelijk espresso zet en melk opschuimt. Met een PID-regeling die de watertemperatuur op een halve graad nauwkeurig houdt en een 58 mm zetgroep.', ['RVS', 'Zwart'], 'cup', '#F1E7DD'],
    ['molenaar-m54', 'Molenaar M54 Koffiemolen', 'Molenaar', '€389,00', 'Koffiemolens', 'Elektrische koffiemolen met 54 mm vlakke maalschijven en traploze maalgraadinstelling, geschikt van espresso tot filter. Weinig restkoffie dankzij de rechte uitloop.', ['Mat zwart'], 'tool', '#ECE6E0'],
    ['huisblend-1kg', 'Bonenbar Huisblend 1 kg', 'Bonenbar', '€24,95', 'Koffiebonen', 'Melange van Braziliaanse en Ethiopische bonen, medium gebrand, met tonen van chocolade en rood fruit. Gebrand in kleine partijen; de brand-datum staat op de zak.', ['Hele bonen', 'Gemalen'], 'steam', '#EFE3D6'],
    ['flow-melkkan', 'Flow Melkkan 600 ml', 'Flow', '€29,95', 'Accessoires', 'Melkkan van roestvrij staal met een scherpe tuit voor latte art. Met maatstreepjes aan de binnenkant.', ['600 ml'], 'drop', '#E8ECEF'],
    ['helder-ontkalker', 'Helder Ontkalker 500 ml', 'Helder', '€12,95', 'Onderhoud', 'Vloeibare ontkalker op basis van melkzuur voor espressomachines en waterkokers. Goed voor vier ontkalkbeurten.', ['500 ml'], 'thermo', '#E5EEF0'],
    ['tamper-pro-58', 'Tamper Pro 58 mm', 'Rivolta', '€44,95', 'Accessoires', 'Tamper met een vlakke voet van 58 mm en een veer die bij 15 kilo druk klikt, zodat je elke keer even hard aandrukt.', ['58 mm'], 'scale', '#EDE8E2'],
  ]),
  shop('thuiskok', 'Thuiskok', '#9C4320', [
    ['ferro-pan-28', 'Ferro Gietijzeren Pan 28 cm', 'Ferro', '€89,95', 'Pannen', 'Gietijzeren koekenpan van 28 cm die warmte lang vasthoudt, geschikt voor inductie, gas en oven. Wordt geleverd voorgebakken met plantaardige olie.', ['28 cm'], 'steam', '#F0E4DC'],
    ['snede-koksmes-20', 'Snede Koksmes 20 cm', 'Snede', '€129,00', 'Messen', 'Koksmes van 20 cm met een lemmet van Japans staal met een hardheid van 60 HRC en een handvat van olijfhout. Geslepen onder een hoek van 15 graden.', ['20 cm'], 'tool', '#E9E7E4'],
    ['kern-snijplank', 'Kern Snijplank Eikenhout', 'Kern', '€59,95', 'Snijplanken', 'Snijplank van kops eikenhout, 40 bij 30 centimeter, met een sapgeul. Kops hout spaart de snede van je messen.', ['40 x 30 cm'], 'home', '#EEE6DA'],
    ['stoom-snelkookpan', 'Stoom Snelkookpan 6 liter', 'Stoom', '€119,00', 'Pannen', 'Snelkookpan van 6 liter met twee drukstanden en een drievoudige veiligheidsklep. Peulvruchten en stoofvlees zijn in een derde van de tijd gaar.', ['6 liter'], 'thermo', '#E6EAEC'],
    ['gaar-thermometer', 'Gaar Kerntemperatuurmeter', 'Gaar', '€34,95', 'Gereedschap', 'Digitale kerntemperatuurmeter die binnen drie seconden de temperatuur toont, met een uitklapbare sonde en een magneet achterop.', ['Zwart'], 'thermo', '#EAE9E3'],
  ]),
  shop('klankhuis', 'Klankhuis', '#2B3F9E', [
    ['ruis-nc700', 'Ruis NC-700 Koptelefoon', 'Ruis', '€279,00', 'Koptelefoons', 'Draadloze koptelefoon met actieve ruisonderdrukking en tot 30 uur batterijduur. Opvouwbaar, met een transparantiemodus om je omgeving te horen.', ['Zwart', 'Zand'], 'volume', '#E6E8F2'],
    ['beeldsterk-oled-55', 'Beeldsterk OLED 55 inch', 'Beeldsterk', '€1.499,00', 'Televisies', 'OLED-televisie van 55 inch met 120 Hz, vier HDMI 2.1-aansluitingen en een filmmaker-stand die het beeld toont zoals de regisseur het bedoelde.', ['55 inch'], 'tvi', '#E4E7F0'],
    ['kamer-soundbar-s5', 'Kamer Soundbar S5', 'Kamer', '€499,00', 'Soundbars', 'Soundbar met vijf luidsprekers en een draadloze subwoofer. Past zijn geluid aan de ruimte aan met een meting via de meegeleverde microfoon.', ['Zwart'], 'film', '#E8E6EF'],
    ['draad-speaker-mini', 'Draad Speaker Mini', 'Draad', '€99,00', 'Speakers', 'Kleine draadloze speaker die tegen een plens water kan, met 12 uur batterij en een lus om hem aan je tas te hangen.', ['Blauw', 'Grijs'], 'plug', '#E5EDF1'],
  ]),
];
