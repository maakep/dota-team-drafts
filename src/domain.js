export const POSITIONS = [1, 2, 3, 4, 5];
export const ROLES = ['Carry', 'Mid', 'Offlane', 'Soft support', 'Hard support'];
export const MAX_HEROES = 8;

export function validateDraft(value, heroIds) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Draft must be a JSON object.'];
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id)) errors.push('ID must be 1–80 lowercase letters, numbers or hyphens.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100) errors.push('Title must be 1–100 characters.');
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 3000)) errors.push('Description must be text, up to 3,000 characters.');
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 12 || value.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 30))) errors.push('Use up to 12 tags, each 1–30 characters.');
  const primary = [];
  for (const p of POSITIONS) {
    const heroes = value[`pos${p}`];
    if (!Array.isArray(heroes) || !heroes.length || heroes.length > MAX_HEROES) { errors.push(`Position ${p} needs 1–${MAX_HEROES} heroes.`); continue; }
    if (heroes.some(h => typeof h !== 'string' || !heroIds.has(h))) errors.push(`Position ${p} contains an unknown hero. Use hero IDs from data/heroes.json.`);
    if (new Set(heroes).size !== heroes.length) errors.push(`Position ${p} contains a duplicate hero.`);
    primary.push(heroes[0]);
  }
  if (new Set(primary).size !== primary.length) errors.push('Primary heroes must be different in each position.');
  return errors;
}

export function cleanDraft(value) {
  const out = { id: value.id, title: value.title.trim() };
  if (value.description?.trim()) out.description = value.description.trim();
  if (value.tags?.length) out.tags = [...new Set(value.tags.map(t => t.trim()).filter(Boolean))];
  for (const p of POSITIONS) out[`pos${p}`] = [...value[`pos${p}`]];
  return out;
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchesSearch(draft, query, heroes, position = '') {
  const pool = position ? draft[`pos${position}`] : POSITIONS.flatMap(p => draft[`pos${p}`]);
  const words = pool.flatMap(id => [id, heroes.get(id)?.name, ...(heroes.get(id)?.aliases ?? [])]);
  const text = normalizeText([draft.title, draft.description, ...(draft.tags ?? []), ...words].join(' '));
  return normalizeText(query).split(' ').filter(Boolean).every(token => text.includes(token));
}

// Find a complete, unique lineup in priority order. Greedy selection fails for flex heroes.
export function resolveLineup(draft, unavailable = new Set(), locks = {}) {
  const selected = {};
  const used = new Set();
  function visit(index) {
    if (index === POSITIONS.length) return true;
    const p = POSITIONS[index];
    const candidates = locks[p] ? [locks[p]] : draft[`pos${p}`];
    for (const hero of candidates) {
      if (!draft[`pos${p}`].includes(hero) || unavailable.has(hero) || used.has(hero)) continue;
      selected[p] = hero; used.add(hero);
      if (visit(index + 1)) return true;
      used.delete(hero); delete selected[p];
    }
    return false;
  }
  return visit(0) ? selected : null;
}

export function githubCreateUrl(config, draft) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository ?? '')) return null;
  const branch = config.branch || 'main';
  const url = new URL(`https://github.com/${config.repository}/new/${encodeURIComponent(branch)}`);
  url.searchParams.set('filename', `data/drafts/${draft.id}.json`);
  url.searchParams.set('value', `${JSON.stringify(cleanDraft(draft), null, 2)}\n`);
  return url.href;
}

export function extractMatch(summary, details, teamId) {
  // Explicit team IDs take precedence. Otherwise use the team endpoint's side flag.
  let radiant;
  if (Number(teamId) > 0 && Number(details.radiant_team_id) === Number(teamId)) radiant = true;
  else if (Number(teamId) > 0 && Number(details.dire_team_id) === Number(teamId)) radiant = false;
  else if (typeof summary.radiant === 'boolean') radiant = summary.radiant;
  else throw new Error('The team side is missing from this match.');
  const players = (details.players ?? []).filter(p => Number.isInteger(p.hero_id) && p.hero_id > 0 && Number.isInteger(p.player_slot));
  const own = players.filter(p => (p.player_slot < 128) === radiant);
  const enemy = players.filter(p => (p.player_slot < 128) !== radiant);
  const picked = side => (details.picks_bans ?? []).filter(p => p.is_pick && p.team === side && p.hero_id > 0).sort((a,b) => a.order - b.order).map(p => p.hero_id);
  const ownIds = own.length ? own.sort((a,b) => a.player_slot - b.player_slot).map(p => p.hero_id) : picked(radiant ? 0 : 1);
  const enemyIds = enemy.length ? enemy.sort((a,b) => a.player_slot - b.player_slot).map(p => p.hero_id) : picked(radiant ? 1 : 0);
  return {
    id: summary.match_id ?? details.match_id,
    startTime: summary.start_time ?? details.start_time,
    duration: summary.duration ?? details.duration,
    opponent: summary.opposing_team_name || (radiant ? details.dire_team?.name : details.radiant_team?.name) || 'Unknown team',
    league: summary.league_name || details.league?.name || '',
    radiant,
    won: typeof (summary.radiant_win ?? details.radiant_win) === 'boolean' ? (summary.radiant_win ?? details.radiant_win) === radiant : null,
    heroes: [...new Set(ownIds)],
    opponents: [...new Set(enemyIds)],
    complete: ownIds.length === 5
  };
}
