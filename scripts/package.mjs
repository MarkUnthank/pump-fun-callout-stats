import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'dist/callout-stats');
// An explicit list keeps demo fixtures, research and tests out of the extension.
const files = ['manifest.json', 'background.js', 'shared-api.js', 'cache.js', 'loader.js', 'api.js', 'stats.js', 'tone.js', 'app.js', 'panel.css', 'card.css', 'mascot.png', 'fonts/fredoka.woff2', 'fonts/LICENSE-fredoka.txt', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png', 'content.js', 'feed.js', 'account.js', 'extension-client.js', 'popup.html', 'popup.css', 'popup.js'];
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await Promise.all(files.map(async (file) => {
  await mkdir(dirname(resolve(destination, file)), { recursive: true });
  await copyFile(resolve(root, file), resolve(destination, file));
}));
const entries = await Promise.all(files.map(async file => [file, new Uint8Array(await readFile(resolve(destination, file)))]));
await writeFile(resolve(root, 'dist/callout-stats.zip'), zipSync(Object.fromEntries(entries)));
console.log(`Load unpacked: ${destination}\nZIP: ${resolve(root, 'dist/callout-stats.zip')}`);
