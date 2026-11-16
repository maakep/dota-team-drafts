import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POSITIONS, validateDraft, cleanDraft, matchesSearch, resolveLineup, preferredLineup, draftHash, parseDraftHash, lineupText, githubCreateUrl, extractMatch } from '../src/domain.js';

const catalog = JSON.parse(await readFile(new URL('../data/heroes.json', import.meta.url), 'utf8'));
const heroes = new Map(catalog.map((h) => [h.id, h]));
const draft = () => ({ id: 'test-draft', title: 'Fight at twenty', tags: ['teamfight'], pos1: ['luna', 'sven'], pos2: ['puck', 'luna'], pos3: ['axe'], pos4: ['rubick'], pos5: ['lich'] });

test('draft files accept optional notes and tags, and flex alternatives', () => {
  assert.deepEqual(validateDraft(draft(), heroes), []);
  const value = draft();
  delete value.tags;
  assert.deepEqual(validateDraft(value, heroes), []);
});
test('import validation rejects unsafe filenames, unknown heroes, empty slots and duplicate primaries', () => {
  for (const change of [{ id: '../../workflow' }, { pos1: ['not-a-hero'] }, { pos5: [] }, { pos2: ['luna'] }, { tags: [{}] }, { description: {} }])
    assert.ok(validateDraft({ ...draft(), ...change }, heroes).length);
  assert.ok(validateDraft(null, heroes).length);
  assert.ok(validateDraft([], heroes).length);
});
test('draft exports strip browser metadata and arbitrary imported keys', () => {
  const cleaned = cleanDraft({ ...draft(), _source: 'local', untrusted: 'x', title: '  Fight at twenty  ', tags: ['teamfight', 'teamfight'] });
  assert.equal(cleaned.title, 'Fight at twenty');
  assert.equal(cleaned._source, undefined);
  assert.equal(cleaned.untrusted, undefined);
  assert.deepEqual(cleaned.tags, ['teamfight']);
});
test('search includes alternative hero names, aliases and tags', () => {
  const value = { ...draft(), pos5: ['crystal_maiden'] };
  for (const query of ['SVEN', 'crystal maiden', 'cm', 'teamfight', 'fight sven']) assert.equal(matchesSearch(value, query, heroes), true, query);
  assert.equal(matchesSearch(value, 'medusa', heroes), false);
});
test('position search restricts hero matching to that position', () => {
  assert.equal(matchesSearch(draft(), 'sven', heroes, '1'), true);
  assert.equal(matchesSearch(draft(), 'sven', heroes, '2'), false);
});
test('priority resolution backtracks to preserve five unique heroes', () => {
  const result = resolveLineup(draft(), new Set(['puck']));
  assert.equal(result[1], 'sven');
  assert.equal(result[2], 'luna');
  assert.equal(new Set(Object.values(result)).size, 5);
});
test('unavailable heroes and conflicting required choices never yield an invalid lineup', () => {
  assert.equal(resolveLineup(draft(), new Set(['luna', 'sven'])), null);
  assert.equal(resolveLineup(draft(), new Set(), { 1: 'luna', 2: 'luna' }), null);
  assert.equal(resolveLineup(draft(), new Set(['luna']), { 1: 'luna' }), null);
  assert.equal(resolveLineup(draft(), new Set(), { 1: 'sven' })[1], 'sven');
});
test('key bans are optional, validated, and preserved for GitHub', () => {
  assert.deepEqual(validateDraft({ ...draft(), bans: ['pudge', 'silencer'] }, heroes), []);
  assert.deepEqual(cleanDraft({ ...draft(), bans: ['pudge', 'silencer'] }).bans, ['pudge', 'silencer']);
  assert.equal(cleanDraft({ ...draft(), bans: [] }).bans, undefined);
  for (const bans of [['pudge', 'pudge'], ['not-a-hero'], {}]) assert.ok(validateDraft({ ...draft(), bans }, heroes).length);
});
test('choosing a hero preserves other choices when possible without a lock toggle', () => {
  const current = resolveLineup(draft());
  const selected = preferredLineup(draft(), current, new Set(), { 1: 'sven' });
  assert.equal(selected[1], 'sven');
  assert.equal(selected[2], current[2]);
  assert.deepEqual(preferredLineup(draft(), selected, new Set(), { 1: 'sven' }), selected);
  const flex = preferredLineup(draft(), current, new Set(), { 2: 'luna' });
  assert.equal(flex[1], 'sven');
  assert.equal(flex[2], 'luna');
});
test('shared draft links and clipboard text preserve choices in lane order', () => {
  assert.deepEqual(POSITIONS, [1, 5, 2, 4, 3]);
  const choices = preferredLineup(draft(), {}, new Set(), { 1: 'sven' });
  const hash = draftHash(draft().id, choices);
  assert.deepEqual(parseDraftHash(hash), { id: draft().id, choices });
  const text = lineupText('https://example.com/team-drafts/', draft(), choices, heroes);
  assert.equal(text, `[Fight at twenty](<https://example.com/team-drafts/${hash}>)\npos 1: Sven\npos 5: Lich\n\npos 2: Puck\n\npos 4: Rubick\npos 3: Axe`);
  assert.equal(parseDraftHash('#unrelated'), null);
  assert.throws(() => lineupText('https://example.com', draft(), {}, heroes), /five different/);
  assert.equal(resolveLineup(draft(), new Set(), parseDraftHash('#draft/test-draft?pos1=unknown').choices), null);
});
test('GitHub handoff carries a valid JSON file without credentials', () => {
  const config = { repository: 'maakep/dota-team-drafts', branch: 'main' };
  const url = new URL(githubCreateUrl(config, draft()));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.searchParams.get('filename'), 'data/drafts/test-draft.json');
  assert.deepEqual(JSON.parse(url.searchParams.get('value')), cleanDraft(draft()));
  assert.equal(url.username, '');
  assert.equal(githubCreateUrl({ repository: 'https://evil.example' }, draft()), null);
});
const details = {
  match_id: 123,
  radiant_team_id: 42,
  dire_team_id: 51,
  radiant_win: false,
  players: [...Array.from({ length: 5 }, (_, i) => ({ hero_id: i + 1, player_slot: i })), ...Array.from({ length: 5 }, (_, i) => ({ hero_id: i + 10, player_slot: 128 + i }))],
};
test('match normalization selects the configured team and correct result on either side', () => {
  const radiant = extractMatch({}, details, 42),
    dire = extractMatch({}, details, 51);
  assert.deepEqual(radiant.heroes, [1, 2, 3, 4, 5]);
  assert.equal(radiant.won, false);
  assert.deepEqual(dire.heroes, [10, 11, 12, 13, 14]);
  assert.equal(dire.won, true);
  assert.equal(dire.complete, true);
});
test('manual side is used when match records lack team IDs; no position inference', () => {
  const match = extractMatch({ radiant: false }, { ...details, radiant_team_id: null, dire_team_id: null }, 42);
  assert.deepEqual(match.heroes, [10, 11, 12, 13, 14]);
  assert.equal(match.pos1, undefined);
  assert.throws(() => extractMatch({}, { ...details, radiant_team_id: null, dire_team_id: null }, null), /side is missing/);
});
test('picks can recover the lineup without parsed player data', () => {
  const match = extractMatch(
    { radiant: true },
    {
      picks_bans: [
        { team: 0, is_pick: true, hero_id: 5, order: 2 },
        { team: 0, is_pick: false, hero_id: 1, order: 0 },
        { team: 1, is_pick: true, hero_id: 10, order: 1 },
        { team: 0, is_pick: true, hero_id: 3, order: 1 },
      ],
    },
    42,
  );
  assert.deepEqual(match.heroes, [3, 5]);
  assert.deepEqual(match.opponents, [10]);
  assert.equal(match.complete, false);
  assert.equal(match.won, null);
});
