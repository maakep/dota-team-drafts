import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = 'https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json';
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Hero catalog: HTTP ${response.status}`);
const raw = await response.json();
const aliases = {
  antimage: ['am', 'anti mage'], crystal_maiden: ['cm'], furion: ['nature prophet', 'np'],
  skeleton_king: ['wraith king', 'wk'], windrunner: ['windranger', 'wr'], zuus: ['zeus'],
  life_stealer: ['lifestealer', 'ls'], nevermore: ['shadow fiend', 'sf'],
  rattletrap: ['clockwerk', 'clock'], obsidian_destroyer: ['outworld destroyer', 'od'],
  wisp: ['io'], magnataur: ['magnus'], centaur: ['centaur warrunner', 'cw'],
  vengefulspirit: ['vengeful spirit', 'vs'], treant: ['treant protector', 'tree'],
  doom_bringer: ['doom'], queenofpain: ['queen of pain', 'qop'],
  phantom_assassin: ['pa'], phantom_lancer: ['pl'], keeper_of_the_light: ['kotl'],
  spirit_breaker: ['sb', 'bara'], bounty_hunter: ['bh'], ancient_apparition: ['aa'],
  dragon_knight: ['dk'], night_stalker: ['ns'], templar_assassin: ['ta'],
  nyx_assassin: ['nyx'], dark_willow: ['willow'], monkey_king: ['mk'],
};
await mkdir(path.join(root, 'assets/heroes'), { recursive: true });
const heroes = Object.values(raw).map(h => {
  const id = h.name.replace('npc_dota_hero_', '');
  return { id, heroId: h.id, name: h.localized_name, attribute: h.primary_attr, aliases: aliases[id] ?? [], image: `assets/heroes/${id}.png` };
}).sort((a,b) => a.name.localeCompare(b.name));
let next = 0, downloaded = 0;
await Promise.all(Array.from({length: 6}, async () => {
  while (next < heroes.length) {
    const hero = heroes[next++];
    const target = path.join(root, hero.image);
    try { await access(target); continue; } catch {}
    const url = `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.id}.png`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${hero.name} portrait: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`${hero.name}: expected PNG`);
    await writeFile(target, buffer); downloaded++;
  }
}));
await writeFile(path.join(root, 'data/heroes.json'), `${JSON.stringify(heroes, null, 2)}\n`);
console.log(`${heroes.length} heroes; ${downloaded} portraits downloaded. Assets are stored locally.`);
