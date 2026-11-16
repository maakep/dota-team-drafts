import { readFile, readdir, mkdir, cp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateDraft } from '../src/domain.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function build() {
  const read = async p => JSON.parse(await readFile(path.join(root, p), 'utf8'));
  const heroes = await read('data/heroes.json');
  const heroIds = new Set(heroes.map(h => h.id));
  const config = await read('data/config.json');
  if (config.teamId !== null && (!Number.isSafeInteger(config.teamId) || config.teamId <= 0)) throw new Error('config.teamId must be a positive integer or null.');
  if (typeof config.teamName !== 'string') throw new Error('config.teamName must be a string.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) throw new Error('config.repository must be owner/repo.');
  if (typeof config.branch !== 'string' || !config.branch.trim()) throw new Error('config.branch is required.');
  if (config.historyMatchId !== undefined && (!Number.isSafeInteger(config.historyMatchId) || config.historyMatchId <= 0)) throw new Error('config.historyMatchId must be a positive match ID.');
  if (config.manualMatches !== undefined && (!Array.isArray(config.manualMatches) || config.manualMatches.length > 50 || config.manualMatches.some(m => !Number.isSafeInteger(m.id) || m.id <= 0 || !['radiant','dire'].includes(m.side)))) throw new Error('config.manualMatches must contain up to 50 {id, side} entries with numeric IDs and radiant/dire sides.');
  const files = (await readdir(path.join(root, 'data/drafts'))).filter(f => f.endsWith('.json')).sort();
  const drafts = [];
  for (const file of files) {
    const draft = await read(`data/drafts/${file}`);
    const errors = validateDraft(draft, heroIds);
    if (file !== `${draft.id}.json`) errors.push('Filename must match the draft ID.');
    if (drafts.some(d => d.id === draft.id)) errors.push('Duplicate draft ID.');
    if (errors.length) throw new Error(`${file}: ${errors.join(' ')}`);
    drafts.push(draft);
  }
  for (const hero of heroes) await access(path.join(root, hero.image));
  const out = path.join(root, 'dist');
  await mkdir(path.join(out, 'data'), { recursive: true });
  await cp(path.join(root, 'index.html'), path.join(out, 'index.html'));
  await cp(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
  const sources = (await readdir(path.join(root,'src'))).filter(f=>/\.(js|css)$/.test(f)).sort();
  const version = createHash('sha256');
  for (const file of sources) version.update(await readFile(path.join(root,'src',file)));
  const revision = version.digest('hex').slice(0,12);
  const html = await readFile(path.join(root,'index.html'),'utf8');
  await writeFile(path.join(out,'index.html'),html.replace(/\.\/src\/(app\.js|styles\.css)/g,`./src/$1?v=${revision}`));
  for (const file of sources.filter(f=>f.endsWith('.js'))) {
    const code = await readFile(path.join(root,'src',file),'utf8');
    await writeFile(path.join(out,'src',file),code.replace(/from (['"])(\.\/[^'"]+\.js)\1/g,`from '$2?v=${revision}'`));
  }
  await cp(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true });
  for (const file of ['config.json', 'heroes.json', 'matches.json']) await cp(path.join(root, 'data', file), path.join(out, 'data', file));
  await writeFile(path.join(out, 'data/drafts.json'), `${JSON.stringify(drafts)}\n`);
  await writeFile(path.join(out, '.nojekyll'), '');
  console.log(`Built ${drafts.length} drafts and ${heroes.length} heroes → dist/`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
