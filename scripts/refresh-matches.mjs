import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadTeamMatches } from '../src/opendota.js';

const read = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
const config = await read('config');
if (!config.teamId) { console.log('No team ID configured; match sync skipped.'); process.exit(0); }
const previous = await read('matches');
const result = await loadTeamMatches(config, { previous, onProgress: (done,total) => console.log(`Matches: ${done}/${total}`) });
await writeFile(fileURLToPath(new URL('../data/matches.json', import.meta.url)), `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.teamName || result.teamId}: ${result.matches.length} tracked matches. No API key used.`);
for (const warning of result.warnings) console.warn(warning);
