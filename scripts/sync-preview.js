// The studio's customer preview is the AmplifAI demo itself, embedded (?embed=1). This copies the
// demo into the engine, so the engine stays self-contained. Run after changing the demo: npm run sync-preview
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const from = fileURLToPath(new URL('../../index.html', import.meta.url)), to = fileURLToPath(new URL('../studio/guide-preview.html', import.meta.url));
if (!existsSync(from)) { console.error('Demo niet gevonden: ' + from); process.exit(1) }
copyFileSync(from, to);
console.log('Voorbeeld bijgewerkt vanuit de demo.');
