import { extractMatch } from './domain.js';

export async function api(path, fetcher = fetch) {
  const response = await fetcher(`https://api.opendota.com/api${path}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'OpenDota rate limit reached. Try again in a minute.' : `OpenDota returned HTTP ${response.status}.`);
  const body = await response.text();
  if (!body.trim()) throw new Error('OpenDota has no team metadata for this ID.');
  let value;
  try { value = JSON.parse(body); } catch { throw new Error('OpenDota returned an invalid response. Try again later.'); }
  if (value?.error) throw new Error('OpenDota could not find this data.');
  return value;
}

export async function loadSingleMatch(id, teamId, side = '', fetcher = fetch) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('Enter a positive numeric match ID.');
  const detail = await api(`/matches/${id}`, fetcher);
  if (!detail || !Array.isArray(detail.players)) throw new Error('OpenDota has no match data for this ID.');
  const summary = side ? { radiant: side === 'radiant' } : {};
  return extractMatch(summary, detail, teamId);
}

export async function loadTeamMatches(config, { onProgress = () => {}, fetcher = fetch, previous = null, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!config.teamId) throw new Error('Add a team ID in settings first.');
  let team = {}, summaries = [], warnings = [];
  // Missing team metadata is common for amateur teams; match history can still work.
  try { team = await api(`/teams/${config.teamId}`, fetcher) || {}; } catch {}
  await delay(1100);
  let listingSucceeded = false;
  try {
    const value = await api(`/teams/${config.teamId}/matches`, fetcher);
    if (!Array.isArray(value)) throw new Error('OpenDota returned an invalid match list.');
    summaries = value.slice(0, config.matchLimit); listingSucceeded = true;
  } catch (error) { warnings.push(error.message); }
  const previousMatches = previous?.teamId === config.teamId ? previous.matches ?? [] : [];
  const old = new Map(previousMatches.map(m => [m.id, m]));
  const requests = summaries.map(summary => ({ id: summary.match_id, summary }));
  for (const match of config.manualMatches ?? []) if (!requests.some(r => r.id === match.id)) requests.push({ id: match.id, side: match.side });
  const matches = [];
  for (const [index, request] of requests.entries()) {
    onProgress(index, requests.length);
    if (old.get(request.id)?.complete) { matches.push(old.get(request.id)); continue; }
    await delay(1100);
    try {
      const detail = await api(`/matches/${request.id}`, fetcher);
      matches.push(extractMatch(request.summary ?? (request.side ? { radiant: request.side === 'radiant' } : {}), detail, config.teamId));
    } catch (error) {
      warnings.push(`Match ${request.id}: ${error.message}`);
      if (old.has(request.id)) matches.push(old.get(request.id));
      else if (request.summary) matches.push(extractMatch(request.summary, {}, config.teamId));
    }
  }
  onProgress(requests.length, requests.length);
  if (!listingSucceeded && !matches.length) throw new Error(warnings.join(' ') || 'OpenDota is unavailable.');
  const byId = new Map(previousMatches.map(m => [m.id, m]));
  for (const match of matches) byId.set(match.id, match);
  return {
    teamId: config.teamId,
    teamName: config.teamName || team.name || previous?.teamName || '',
    updatedAt: new Date().toISOString(),
    matches: [...byId.values()].sort((a,b) => b.id - a.id).slice(0, 50),
    warnings
  };
}
