import { POSITIONS, ROLES, MAX_HEROES, validateDraft, cleanDraft, normalizeText, matchesSearch, resolveLineup, githubCreateUrl } from './domain.js';
import { loadTeamMatches, loadSingleMatch } from './opendota.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  settings: '<path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 3 3-1 2 3 4-1 1-3 3-1 1-4-3-2 1-3-3-2-3 1Z"/><circle cx="12" cy="12" r="3"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
const button = (action, label, glyph, cls = '', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${glyph ? icon(glyph) : ''}${label}</button>`;
const iconButton = (action, label, glyph, cls = '', attrs = '') => button(action, '', glyph, `icon-button ${cls}`, `aria-label="${esc(label)}" title="${esc(label)}" ${attrs}`);
const storageWarnings = [];
function read(key, fallback) { try { const v = localStorage.getItem(`drafts:${key}`); return v === null ? fallback : JSON.parse(v); } catch { storageWarnings.push('Browser storage could not be read.'); return fallback; } }
function write(key, value) { try { localStorage.setItem(`drafts:${key}`, JSON.stringify(value)); return true; } catch { toast('Browser storage is unavailable or full. Export your JSON to keep it.', true); return false; } }
function forget(key) { try { localStorage.removeItem(`drafts:${key}`); } catch {} }
let config, baseConfig, heroes, heroMap, heroByNumber, repoDrafts, localDrafts = [], favorites = new Set();
let view = 'drafts', query = '', tag = '', onlyFavorites = false, position = '', source = 'all';
let unavailable = new Set(), locks = {}, selectedId = null, editor = null, picker = null, busy = false, matchData, matchError = '';
let toastTimer;

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.hidden = false; el.classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 8000 : 3500);
}
function allDrafts() {
  const all = new Map(repoDrafts.map(d => [d.id, { ...d, _source: 'repo' }]));
  for (const d of localDrafts) {
    const remote = all.get(d.id);
    if (!remote || JSON.stringify(cleanDraft(d)) !== JSON.stringify(cleanDraft(remote))) all.set(d.id, { ...d, _source: remote ? 'edited' : 'local' });
  }
  return [...all.values()];
}
const getDraft = id => allDrafts().find(d => d.id === id);
function portrait(id, className = '', eager = false) {
  const hero = heroMap.get(id);
  return hero ? `<img class="${className}" src="./${esc(hero.image)}" alt="${esc(hero.name)}" title="${esc(hero.name)}" width="256" height="144" loading="${eager ? 'eager' : 'lazy'}" decoding="async">` : '<span class="unknown-hero">?</span>';
}
function numberedPortrait(heroId) { return portrait(heroByNumber.get(heroId)?.id, 'match-portrait'); }
const open = id => { const dialog = $(id); if (!dialog.open) dialog.showModal(); };
const close = id => $(id).close();
function rememberFocus(root) {
  const el = document.activeElement;
  return root.contains(el) && el.matches('[data-action]') ? {...el.dataset} : null;
}
function restoreFocus(root, data) {
  if (!data) return;
  $$('[data-action]',root).find(el => !el.disabled && Object.entries(data).every(([key,value])=>el.dataset[key]===value))?.focus({preventScroll:true});
}
function utility(title, content, cls = '') {
  const dialog = $('#utility-dialog'); dialog.className = `utility-dialog ${cls}`;
  dialog.setAttribute('aria-labelledby', 'utility-title');
  dialog.innerHTML = `<header class="dialog-header"><h2 id="utility-title">${esc(title)}</h2>${iconButton('close-utility', 'Close', 'close')}</header>${content}`;
  open('#utility-dialog');
}

async function boot() {
  try {
    const responses = await Promise.all(['config','heroes','drafts','matches'].map(async file => {
      const response = await fetch(`./data/${file}.json`);
      if (!response.ok) throw new Error(`Could not load ${file}.json.`);
      return response.json();
    }));
    [baseConfig, heroes, repoDrafts, matchData] = responses;
    config = { ...baseConfig, ...read('config', {}) };
    heroMap = new Map(heroes.map(h => [h.id, h])); heroByNumber = new Map(heroes.map(h => [h.heroId, h]));
    const saved = read('local', []);
    localDrafts = Array.isArray(saved) ? saved.filter(d => !validateDraft(d, heroMap).length).map(cleanDraft) : [];
    if (!Array.isArray(saved) || saved.length !== localDrafts.length) storageWarnings.push('Some saved drafts are invalid. Export browser data before clearing it.');
    const pinned = read('favorites', []); favorites = new Set(Array.isArray(pinned) ? pinned.filter(id => typeof id === 'string') : []);
    const blocked = read('unavailable', []); unavailable = new Set(Array.isArray(blocked) ? blocked.filter(h => heroMap.has(h)) : []);
    const cached = read(`matches:${config.teamId}`, null);
    if (cached?.teamId === config.teamId && Array.isArray(cached.matches)) matchData = cached;
    if (matchData.teamId !== config.teamId) matchData = { teamId: config.teamId, matches: [] };
    renderShell();
    readHash();
    if (storageWarnings.length) toast(storageWarnings.join(' '), true);
  } catch (error) {
    $('#app').innerHTML = `<main class="load-error"><h1>Drafts could not load</h1><p>${esc(error.message)}</p><p>Serve the built site with <code>npm run dev</code>.</p>${button('reload','Try again','refresh','primary')}</main>`;
  }
}

function renderShell() {
  document.title = `Drafts · ${config.teamName || 'dota-team-drafts'}`;
  $('#app').innerHTML = `<aside class="sidebar">
    <a class="brand" href="#" aria-label="Draft library"><img src="./assets/icon.svg" alt="" width="30" height="30"><span>dota-team-drafts</span></a>
    <div class="team"><span class="team-dot"></span><span>${esc(config.teamName || matchData.teamName || 'Your team')}</span></div>
    <nav aria-label="Main navigation">
      ${button('view-drafts','Drafts','grid','nav-button',`data-view="drafts"`)}
      ${button('view-matches','Matches','history','nav-button',`data-view="matches"`)}
    </nav>
    <section class="collections" aria-label="Draft filters"><h2>Library</h2><div id="collections"></div><h2>Tags</h2><div id="tags"></div></section>
    <div class="sidebar-bottom"><div id="recovery"></div>
      ${button('import','Import JSON','upload','quiet sidebar-link')}
      ${button('export-all','Export library','download','quiet sidebar-link')}
      <div class="sidebar-tools">${button('settings','Settings','settings','quiet')}${iconButton('help','Keyboard shortcuts (?)','keyboard')}</div>
      <span class="storage-note"><span class="status-dot"></span>JSON files + browser drafts</span>
    </div>
  </aside>
  <main id="main" tabindex="-1" class="main">
    <header class="page-header"><div class="page-title"><span class="mobile-brand">Dota drafts /</span><h1 id="page-title">Drafts</h1><span id="total-count" class="count"></span></div><div id="header-actions"></div></header>
    <div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search drafts, heroes, tags…" autocomplete="off" aria-label="Search drafts, heroes and tags"><kbd>/</kbd></label><select id="position-filter" aria-label="Search hero in position"><option value="">Any position</option>${POSITIONS.map(p => `<option value="${p}">Pos ${p} · ${ROLES[p-1]}</option>`).join('')}</select>${iconButton('help','Keyboard shortcuts (?)','keyboard','toolbar-help')}</div>
    <div id="session-bar" class="session-bar"></div>
    <section id="content" aria-label="Draft library"></section>
    <footer class="main-footer"><span id="result-count" aria-live="polite"></span><span><kbd>N</kbd> new draft <span class="footer-dot">·</span> <kbd>?</kbd> shortcuts</span></footer>
  </main>`;
  $('#search').value = query; $('#position-filter').value = position;
  renderNavigation(); renderContent();
}
function renderNavigation() {
  const drafts = allDrafts();
  $('#collections').innerHTML = [
    ['all','All drafts','grid',drafts.length,!onlyFavorites && source === 'all'],
    ['favorites','Starred','star',drafts.filter(d => favorites.has(d.id)).length,onlyFavorites],
    ['local','On this browser','edit',drafts.filter(d => d._source !== 'repo').length,source === 'local'],
  ].map(([action,label,glyph,count,active]) => button(`filter-${action}`,`<span>${label}</span><span class="nav-count">${count}</span>`,glyph,`nav-button small ${active ? 'active' : ''}`,`aria-pressed="${active}"`)).join('');
  const tags = [...new Set(drafts.flatMap(d => d.tags ?? []))].sort();
  $('#tags').innerHTML = tags.length ? tags.map(t => button('tag',`<span class="tag-dot"></span><span>${esc(t)}</span><span class="nav-count">${drafts.filter(d => d.tags?.includes(t)).length}</span>`,'',`tag-filter ${tag === t ? 'active' : ''}`,`data-tag="${esc(t)}" aria-pressed="${tag === t}"`)).join('') : '<span class="muted small-text">No tags yet</span>';
  $('#recovery').innerHTML = read('editor', null) ? button('recover','Continue editing','edit','recovery-button') : '';
  $$('[data-view]').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active',active); if (active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
}
function renderSessionBar() {
  const el = $('#session-bar');
  el.innerHTML = `${button('blocked',`${icon('ban')}<span>Unavailable heroes</span>${unavailable.size ? `<strong>${unavailable.size}</strong>` : ''}`,'','unavailable-button')}
    <div class="blocked-chips">${[...unavailable].map(id => button('unblock',`${portrait(id)}<span>${esc(heroMap.get(id).name)}</span>${icon('close')}`,'','blocked-chip',`data-hero="${id}" aria-label="Make ${esc(heroMap.get(id).name)} available"`)).join('')}</div>
    ${unavailable.size ? button('clear-blocked','Clear','','text-button') : '<span class="session-hint">Mark bans or enemy picks to see your options.</span>'}`;
  el.hidden = view !== 'drafts';
}
function filteredDrafts() {
  return allDrafts().filter(d => (!onlyFavorites || favorites.has(d.id)) && (source !== 'local' || d._source !== 'repo') && (!tag || d.tags?.includes(tag)) && matchesSearch(d,query,heroMap,position)).sort((a,b) => Number(favorites.has(b.id))-Number(favorites.has(a.id)) || a.title.localeCompare(b.title));
}
function renderContent() {
  const focus = rememberFocus(document.body);
  renderNavigation(); renderSessionBar();
  $('#page-title').textContent = view === 'drafts' ? 'Drafts' : 'Matches';
  $('#position-filter').hidden = view !== 'drafts';
  $('#search').placeholder = view === 'drafts' ? 'Search drafts, heroes, tags…' : 'Search opponents, heroes, match IDs…';
  $('#search').setAttribute('aria-label',view === 'drafts' ? 'Search drafts, heroes and tags' : 'Search match history');
  $('#total-count').textContent = view === 'drafts' ? allDrafts().length : matchData.matches.length;
  $('#header-actions').innerHTML = view === 'drafts' ? button('new',`${icon('plus')}<span>New draft</span><kbd>N</kbd>`,'','primary') : `${button('add-match','Add match','plus','secondary')}${button('refresh-matches',busy ? 'Loading…' : 'Refresh','refresh','primary',busy ? 'disabled' : '')}`;
  if (view === 'matches') { renderMatches(); restoreFocus(document.body,focus); return; }
  const drafts = filteredDrafts();
  $('#result-count').textContent = `${drafts.length} of ${allDrafts().length} drafts${tag ? ` · ${tag}` : ''}`;
  $('#content').setAttribute('aria-label','Draft library');
  $('#content').innerHTML = `${tag || query || onlyFavorites || source !== 'all' ? `<div class="filter-summary"><span>${esc(tag || (onlyFavorites ? 'Starred drafts' : source === 'local' ? 'On this browser' : `Results for “${query}”`))}</span>${button('clear-filters','Clear filters','close','text-button')}</div>` : ''}
    ${drafts.length ? `<div class="draft-list">${drafts.map(renderCard).join('')}</div>` : `<div class="empty-state">${icon('search')}<h2>${allDrafts().length ? 'No drafts found' : 'No drafts yet'}</h2><p>${allDrafts().length ? 'Try another hero, tag, or title.' : 'Create a draft or import a JSON file to start your library.'}</p>${button(allDrafts().length ? 'clear-filters' : 'new',allDrafts().length ? 'Clear filters' : 'New draft','plus','secondary')}</div>`}`;
  restoreFocus(document.body,focus);
}
function renderCard(d, index) {
  const lineup = resolveLineup(d,unavailable);
  const starred = favorites.has(d.id);
  return `<article class="draft-card ${unavailable.size && !lineup ? 'no-lineup' : ''}">
    <header class="card-header"><h2>${button('detail',esc(d.title),'','draft-title',`data-id="${d.id}"`)}</h2><div class="card-tags">${(d.tags ?? []).filter(t => t !== 'example').slice(0,3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${d._source !== 'repo' ? `<span class="local-label">${d._source === 'edited' ? 'Local edits' : 'Browser draft'}</span>` : d.tags?.includes('example') ? '<span class="example-label">Example</span>' : ''}
      ${iconButton('favorite',starred ? 'Unstar draft' : 'Star draft','star',starred ? 'starred' : '',`data-id="${d.id}" aria-pressed="${starred}"`)}
    </header>
    <button type="button" data-action="detail" data-id="${d.id}" class="lineup-button" aria-label="Open ${esc(d.title)}">
      ${POSITIONS.map(p => {
        const ids = d[`pos${p}`]; const current = lineup?.[p] || ids.find(h => !unavailable.has(h)) || ids[0];
        return `<div class="position-preview"><div class="position-label"><b>${p}</b><span>${ROLES[p-1]}</span>${current !== ids[0] ? '<span class="backup-label">Backup</span>' : ''}</div><div class="primary-portrait ${unavailable.has(current) ? 'is-unavailable' : ''}">${portrait(current,'',index < 3)}<span>${esc(heroMap.get(current).name)}</span></div><div class="backup-previews">${ids.filter(id => id !== current).map(id => `<span class="mini-portrait ${unavailable.has(id) ? 'is-unavailable' : ''}">${portrait(id)}<small>${ids.indexOf(id)+1}</small></span>`).join('')}${ids.length === 1 ? '<span class="no-backups">No backups</span>' : ''}</div></div>`;
      }).join('')}
    </button>
    <footer class="card-footer"><p>${esc(d.description?.replace(/^Example draft\. /,'') || 'No notes added.')}</p><span class="card-status ${unavailable.size && !lineup ? 'warning' : ''}">${unavailable.size ? lineup ? `${icon('check')} Lineup available` : `${icon('ban')} No complete lineup` : `${POSITIONS.reduce((sum,p) => sum+d[`pos${p}`].length-1,0)} alternatives`}</span></footer>
  </article>`;
}

function showDetail(id, updateHash = true) {
  const d = getDraft(id); if (!d) return;
  const focus = rememberFocus($('#detail-dialog'));
  if (selectedId !== id) locks = {};
  selectedId = id;
  const lineup = resolveLineup(d,unavailable,locks);
  $('#detail-dialog').innerHTML = `<header class="dialog-header detail-header"><div><span class="overline">Draft view</span><h2 id="detail-title">${esc(d.title)}</h2></div><div class="button-row">${iconButton('favorite',favorites.has(id) ? 'Unstar draft' : 'Star draft','star',favorites.has(id) ? 'starred' : '',`data-id="${id}"`)}${button('edit-detail','Edit','edit','secondary')}${iconButton('close-detail','Close draft (Esc)','close')}</div></header>
    ${d.description ? `<p class="detail-description">${esc(d.description)}</p>` : ''}
    <div class="detail-toolbar"><div class="button-row">${button('blocked','Unavailable heroes','ban','secondary')}${unavailable.size ? `<span class="muted">${unavailable.size} unavailable</span>${button('clear-blocked','Clear','','text-button')}` : ''}</div><span class="lineup-status ${!lineup ? 'warning' : ''}">${icon(lineup ? 'check' : 'ban')}${lineup ? 'Five unique heroes available' : 'No complete lineup with these choices'}</span></div>
    <div class="detail-positions">${POSITIONS.map(p => {
      const current = lineup?.[p] || locks[p] || d[`pos${p}`].find(h => !unavailable.has(h));
      return `<section class="detail-position"><h3><b>${p}</b>${ROLES[p-1]}${locks[p] ? '<span class="locked-label">Locked</span>' : ''}</h3><div class="detail-primary ${!current || unavailable.has(current) ? 'is-unavailable' : ''}">${portrait(current || d[`pos${p}`][0],'',true)}<strong>${esc(heroMap.get(current)?.name || 'Unavailable')}</strong></div><div class="hero-options">${d[`pos${p}`].map((hero,i) => `<div class="hero-option ${current === hero ? 'selected' : ''} ${unavailable.has(hero) ? 'is-unavailable' : ''}"><button class="hero-choice" type="button" data-action="choose" data-position="${p}" data-hero="${hero}" aria-pressed="${locks[p] === hero}" ${unavailable.has(hero) ? 'disabled' : ''}><span class="priority">${i+1}</span>${portrait(hero)}<span>${esc(heroMap.get(hero).name)}</span>${locks[p] === hero ? icon('check') : ''}</button>${iconButton('toggle-blocked',unavailable.has(hero) ? `Make ${heroMap.get(hero).name} available` : `Mark ${heroMap.get(hero).name} unavailable`,'ban',unavailable.has(hero) ? 'blocked' : '',`data-hero="${hero}" aria-pressed="${unavailable.has(hero)}"`)}</div>`).join('')}</div></section>`;
    }).join('')}</div>
    <footer class="dialog-footer"><span class="muted">Click a hero to lock it. Click again to release it.${d._source !== 'repo' ? button('remove-local',d._source === 'edited' ? 'Discard local edits' : 'Remove browser draft','','text-button',`data-id="${d.id}"`) : ''}</span><div class="button-row">${Object.keys(locks).length ? button('reset-locks','Reset choices','','secondary') : ''}${button('duplicate','Duplicate','copy','secondary')}${button('export-detail','Export JSON','download','secondary')}${button('github-detail','Send to GitHub','external','primary')}</div></footer>`;
  open('#detail-dialog');
  restoreFocus($('#detail-dialog'),focus);
  if (updateHash && location.hash !== `#draft/${id}`) history.pushState({},'',`#draft/${id}`);
}
function refreshAvailability() {
  write('unavailable',[...unavailable]);
  for (const p of POSITIONS) if (unavailable.has(locks[p])) delete locks[p];
  renderContent();
  if ($('#detail-dialog').open) showDetail(selectedId,false);
}
function closeDetail() {
  close('#detail-dialog'); selectedId = null; locks = {};
  if (location.hash.startsWith('#draft/')) history.replaceState({},'',location.pathname+location.search);
}

function openEditor(draft = null, duplicate = false, suggestions = []) {
  editor = {
    draft: draft ? cleanDraft(draft) : {id:'',title:'',description:'',tags:[],...Object.fromEntries(POSITIONS.map(p => [`pos${p}`,[]]))},
    target: duplicate ? null : draft?.id || null,
    suggestions,
    touched: false,
  };
  if (duplicate) { editor.draft.id = ''; editor.draft.title += ' (copy)'; }
  closeDetail(); renderEditor(); open('#editor-dialog');
}
function saveRecovery() {
  if (!editor) return;
  editor.touched = true;
  write('editor',editor);
  $('#recovery').innerHTML = button('recover','Continue editing','edit','recovery-button');
}
function renderEditor() {
  const focus = rememberFocus($('#editor-dialog'));
  const d = editor.draft;
  $('#editor-dialog').innerHTML = `<header class="dialog-header"><div><span class="overline">${editor.target ? 'Edit draft' : 'New draft'}</span><h2 id="editor-title">${editor.target ? 'Edit lineup' : 'Build a lineup'}</h2></div>${iconButton('close-editor','Close editor; keep unfinished draft','close')}</header>
    <div class="editor-fields"><label>Title<input id="draft-title" maxlength="100" placeholder="Draft name" value="${esc(d.title)}" autocomplete="off"></label><label>Tags <span class="optional">comma separated</span><input id="draft-tags" value="${esc((d.tags ?? []).join(', '))}" placeholder="teamfight, comfort" autocomplete="off"></label><label class="description-field">Notes <span class="optional">optional</span><textarea id="draft-description" maxlength="3000" rows="2" placeholder="Timings, lanes, or things to remember">${esc(d.description)}</textarea></label></div>
    ${editor.suggestions?.length ? `<div class="suggestions"><span>Match heroes · assign positions</span>${editor.suggestions.filter(id => !POSITIONS.some(p => d[`pos${p}`].includes(id))).map(id => button('assign-suggestion',`${portrait(id)}${esc(heroMap.get(id)?.name)}`,'','suggested-hero',`data-hero="${id}"`)).join('')}</div>` : ''}
    <div class="editor-guide"><span>First hero is primary. Alternatives follow in priority order.</span><span class="muted">Up to ${MAX_HEROES} per position</span></div>
    <div class="editor-positions">${POSITIONS.map(p => `<section class="editor-position"><h3><b>${p}</b>${ROLES[p-1]}<span class="muted">${d[`pos${p}`].length}</span></h3><ol class="editable-heroes">${d[`pos${p}`].map((id,i) => `<li><div class="editable-hero-image">${portrait(id)}<span>${i === 0 ? 'Primary' : `Backup ${i}`}</span></div><div class="editable-hero-name">${esc(heroMap.get(id).name)}</div><div class="reorder-tools">${iconButton('move',`Move ${heroMap.get(id).name} up`,'up','',`data-position="${p}" data-index="${i}" data-delta="-1" ${i===0 ? 'disabled' : ''}`)}${iconButton('move',`Move ${heroMap.get(id).name} down`,'down','',`data-position="${p}" data-index="${i}" data-delta="1" ${i===d[`pos${p}`].length-1 ? 'disabled' : ''}`)}${iconButton('remove-hero',`Remove ${heroMap.get(id).name}`,'close','remove-hero',`data-position="${p}" data-index="${i}"`)}</div></li>`).join('')}</ol>${button('add-hero',d[`pos${p}`].length ? 'Add backup' : 'Add hero','plus',`add-hero ${!d[`pos${p}`].length ? 'empty-slot' : ''}`,`data-position="${p}" ${d[`pos${p}`].length >= MAX_HEROES ? 'disabled' : ''}`)}</section>`).join('')}</div>
    <div id="editor-errors" class="form-errors" role="alert" hidden></div><footer class="dialog-footer"><span class="muted">Saved in this browser. Export or send to GitHub to share.</span><div class="button-row">${button('discard-editor','Discard','','text-button')}${button('save-editor','Save draft','check','primary')}</div></footer>`;
  restoreFocus($('#editor-dialog'),focus);
}
function saveEditor() {
  const draft = editor.draft;
  if (!draft.id) draft.id = `${normalizeText(draft.title).replace(/ /g,'-').slice(0,55) || 'draft'}-${Date.now().toString(36)}`;
  const errors = validateDraft(draft,heroMap);
  if (errors.length) { $('#editor-errors').hidden=false; $('#editor-errors').textContent=errors.join(' '); return; }
  const saved = cleanDraft(draft);
  const next = [...localDrafts.filter(d => d.id !== saved.id),saved];
  if (!write('local',next)) return;
  localDrafts = next; forget('editor'); editor=null; close('#editor-dialog'); renderContent(); toast('Draft saved in this browser.'); showDetail(saved.id);
}

function openPicker(mode, p = null) {
  picker = { mode, position:p, search:'', attribute:'' };
  $('#picker-dialog').innerHTML = `<header class="dialog-header"><h2 id="picker-title">${mode === 'block' ? 'Unavailable heroes' : `Add hero · Position ${p}`}</h2>${iconButton('close-picker','Close hero picker','close')}</header><label class="search picker-search">${icon('search')}<input id="hero-search" type="search" placeholder="Find a hero…" aria-label="Find a hero" autocomplete="off" autofocus></label><div class="attribute-filters">${[['','All'],['str','Strength'],['agi','Agility'],['int','Intelligence'],['all','Universal']].map(([attr,label]) => button('attribute',label,'',`attribute-filter ${!attr ? 'active' : ''}`,`data-attribute="${attr}" aria-pressed="${!attr}"`)).join('')}</div><div id="hero-grid" class="hero-grid" aria-label="Heroes"></div><footer class="picker-footer"><span id="hero-count" aria-live="polite"></span><span>${mode === 'block' ? 'Toggle bans and enemy picks. Changes apply immediately.' : 'Select a hero to add it.'}</span></footer>`;
  renderHeroGrid(); open('#picker-dialog'); $('#hero-search').focus();
}
function renderHeroGrid() {
  const list = heroes.filter(h => (!picker.attribute || h.attribute === picker.attribute) && normalizeText([h.name,h.id,...h.aliases].join(' ')).includes(normalizeText(picker.search)));
  $('#hero-count').textContent = `${list.length} heroes`;
  $('#hero-grid').innerHTML = list.length ? list.map(h => {
    const chosen = picker.mode === 'block' ? unavailable.has(h.id) : editor.draft[`pos${picker.position}`].includes(h.id);
    return `<button type="button" class="hero-tile ${chosen ? 'chosen' : ''} ${picker.mode === 'block' && chosen ? 'is-unavailable' : ''}" data-action="pick-hero" data-hero="${h.id}" aria-label="${esc(h.name)}" aria-pressed="${chosen}" ${picker.mode !== 'block' && chosen ? 'disabled' : ''}>${portrait(h.id)}<span>${esc(h.name)}</span>${chosen ? `<b>${icon(picker.mode === 'block' ? 'ban' : 'check')}</b>` : ''}</button>`;
  }).join('') : '<p class="grid-empty">No matching heroes.</p>';
}

function exportJson(value, filename) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value,null,2)}\n`],{type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function showGithub(d) {
  const existing = repoDrafts.some(r => r.id === d.id);
  const url = existing ? `https://github.com/${config.repository}/edit/${encodeURIComponent(config.branch)}/data/drafts/${d.id}.json` : githubCreateUrl(config,d);
  const tooLong = url?.length > 12000;
  const fallback = `https://github.com/${config.repository}/new/${encodeURIComponent(config.branch)}?filename=${encodeURIComponent(`data/drafts/${d.id}.json`)}`;
  utility('Send draft to GitHub',`<div class="utility-body"><p>${existing || tooLong ? 'Copy the JSON, open GitHub, and replace the file contents.' : 'Open GitHub to review the prefilled JSON and commit it to the repository.'} GitHub handles sign-in and permissions.</p><div class="file-path">data/drafts/${esc(d.id)}.json</div><p class="muted small-text">The shared library updates after the Pages workflow finishes. Your browser copy stays available.</p><div class="button-row">${button('copy-json','Copy JSON','copy','secondary',`data-id="${d.id}"`)}<a class="button primary" href="${esc(tooLong ? fallback : url)}" target="_blank" rel="noopener noreferrer">${icon('external')}Open GitHub</a></div></div>`);
}
async function importFile(file) {
  try {
    if (file.size > 1024*1024) throw new Error('JSON files must be under 1 MB.');
    const value = JSON.parse(await file.text()); const items = Array.isArray(value) ? value : [value];
    if (items.length > 200) throw new Error('Import up to 200 drafts at a time.');
    const ids = new Set();
    for (const item of items) {
      const errors = validateDraft(item,heroMap);
      if (errors.length) throw new Error(`${item?.title || 'Draft'}: ${errors.join(' ')}`);
      if (ids.has(item.id)) throw new Error('The import has duplicate draft IDs.'); ids.add(item.id);
    }
    const conflicts = items.filter(item => allDrafts().some(d => d.id === item.id));
    const commitImport = () => {
      const next = [...localDrafts.filter(d => !ids.has(d.id)), ...items.map(cleanDraft)];
      if (!write('local',next)) return;
      localDrafts=next; close('#utility-dialog'); view='drafts'; renderContent(); toast(`Imported ${items.length} draft${items.length===1 ? '' : 's'}.`);
    };
    if (conflicts.length) {
      utility('Replace existing drafts?',`<div class="utility-body"><p>${conflicts.length} draft${conflicts.length===1 ? '' : 's'} already exist. Importing replaces their browser copies.</p><p>${esc(conflicts.map(d => d.title).join(', '))}</p><div class="button-row">${button('close-utility','Cancel','','secondary')}<button id="confirm-import" class="primary" type="button">Replace and import</button></div></div>`);
      $('#confirm-import').addEventListener('click',commitImport,{once:true});
    } else commitImport();
  } catch (error) { toast(error.message,true); }
}

function renderMatches() {
  const list = matchData.matches.filter(m => normalizeText([m.id,m.opponent,m.league,...(m.heroes ?? []).map(id => heroByNumber.get(id)?.name)].join(' ')).includes(normalizeText(query)));
  const synced = matchData.updatedAt ? new Date(matchData.updatedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : '';
  $('#result-count').textContent = `${list.length} matches${synced ? ` · Updated ${synced}` : ''}`;
  $('#content').setAttribute('aria-label','Team match history');
  $('#content').innerHTML = `${matchError ? `<div class="notice error-notice" role="alert">${esc(matchError)} Cached matches are kept.</div>` : ''}${busy ? '<div class="notice" id="match-progress" role="status">Loading OpenDota match data…</div>' : ''}
    ${matchData.warnings?.length && !matchError ? `<div class="notice">Some OpenDota data was unavailable. ${esc(matchData.warnings[0])}</div>` : ''}
    ${list.length ? `<div class="matches-list">${list.map(m => `<article class="match-card"><header><div><span class="result ${m.won === true ? 'won' : m.won === false ? 'lost' : ''}">${m.won === true ? 'WIN' : m.won === false ? 'LOSS' : '—'}</span><h2>vs ${esc(m.opponent)}</h2></div><span class="muted">${m.startTime ? new Date(m.startTime*1000).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : ''}</span></header><div class="match-lineups"><section><h3>Our heroes <span>${m.radiant ? 'Radiant' : 'Dire'}</span></h3><div class="match-heroes">${m.heroes?.length ? m.heroes.map(numberedPortrait).join('') : '<span class="muted">Hero data unavailable</span>'}</div></section><span class="versus">vs</span><section><h3>${esc(m.opponent)}</h3><div class="match-heroes">${m.opponents?.length ? m.opponents.map(numberedPortrait).join('') : '<span class="muted">Hero data unavailable</span>'}</div></section></div><footer><span class="muted">${esc(m.league)} ${m.duration ? `· ${Math.floor(m.duration/60)}:${String(m.duration%60).padStart(2,'0')}` : ''} · ${m.id}</span><div class="button-row">${m.heroes?.length === 5 ? button('draft-from-match','Create draft','plus','text-button',`data-match="${m.id}"`) : ''}<a href="https://www.opendota.com/matches/${m.id}" target="_blank" rel="noopener noreferrer" class="text-button">OpenDota ${icon('external')}</a></div></footer></article>`).join('')}</div><p class="match-note">Hero order is from the match record. Positions 1–5 are not inferred.</p>` : `<div class="empty-state">${icon('history')}<h2>${query ? 'No matches found' : busy ? 'Loading match history' : 'No tracked matches yet'}</h2><p>${query ? 'Try another opponent, hero, or match ID.' : 'OpenDota may not index this team’s amateur or private lobbies. Try a match ID directly.'}</p><div class="button-row">${button('add-match','Add match ID','plus','secondary')}${query ? button('clear-filters','Clear search','','text-button') : ''}</div></div>`}
    <div class="matches-bottom"><span>OpenDota · keyless access · ${esc(config.teamName || matchData.teamName || config.teamId || 'No team configured')}</span>${button('export-matches','Export snapshot','download','text-button')}</div>`;
}
async function refreshMatches(force = false) {
  if (busy || !config.teamId) return;
  if (!force && matchData.updatedAt && Date.now()-Date.parse(matchData.updatedAt)<30*60*1000) return;
  busy=true; matchError=''; renderContent();
  try {
    matchData = await loadTeamMatches(config,{previous:matchData,onProgress:(done,total) => { const el=$('#match-progress'); if (el) el.textContent=`Loading OpenDota · ${done} of ${total} matches`; }});
    write(`matches:${config.teamId}`,matchData);
    if (!config.teamName && matchData.teamName) { config.teamName=matchData.teamName; renderShell(); }
  } catch (error) { matchError=error.message; }
  finally { busy=false; if (view==='matches') renderContent(); }
}
function showAddMatch() {
  utility('Add a match',`<div class="utility-body"><p>Load a match by ID when it is missing from the team history.</p><label>Match ID<input id="match-id" type="text" inputmode="numeric" pattern="[0-9]+" placeholder="e.g. 8123456789" autocomplete="off"></label><label>Our side<select id="match-side"><option value="">Detect from team ID</option><option value="radiant">Radiant</option><option value="dire">Dire</option></select></label><p class="muted small-text">Choose a side if the match has no team IDs. This adds it to your browser’s config and match cache.</p><p id="match-add-error" class="form-errors" role="alert" hidden></p>${button('load-match','Load match','download','primary')}</div>`);
  $('#match-id').focus();
}
async function addMatch() {
  const id = Number($('#match-id').value.trim()); const side = $('#match-side').value; const el=$('[data-action="load-match"]'); el.disabled=true; el.textContent='Loading…';
  try {
    const match=await loadSingleMatch(id,config.teamId,side);
    if (!match.heroes.length) throw new Error('No hero picks are available for this match.');
    const nextData={...matchData,teamId:config.teamId,updatedAt:new Date().toISOString(),matches:[...matchData.matches.filter(m=>m.id!==match.id),match].sort((a,b)=>b.id-a.id)};
    const nextConfig={...config,manualMatches:[...(config.manualMatches ?? []).filter(m=>m.id!==id),{id,side:match.radiant ? 'radiant' : 'dire'}]};
    if (!write(`matches:${config.teamId}`,nextData) || !write('config',nextConfig)) return;
    matchData=nextData; config=nextConfig; close('#utility-dialog'); view='matches'; renderContent(); toast('Match saved in this browser. Export the snapshot to share it.');
  } catch (error) { $('#match-add-error').hidden=false; $('#match-add-error').textContent=`${error.message} If team detection failed, select Radiant or Dire.`; }
  finally { if(el.isConnected) {el.disabled=false;el.textContent='Load match';} }
}
function showSettings() {
  utility('Settings',`<div class="utility-body"><label>Team name<input id="team-name" maxlength="100" value="${esc(config.teamName)}"></label><label>Dota team ID<input id="team-id" inputmode="numeric" value="${esc(config.teamId || '')}"></label><label>Matches to fetch<select id="match-limit">${[5,10,20].map(n=>`<option ${config.matchLimit===n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Repository<input value="${esc(config.repository)}" readonly></label><p class="muted small-text">Settings apply to this browser. Export config.json and commit it to set defaults for the team.</p><p id="settings-error" class="form-errors" role="alert" hidden></p><div class="button-row">${button('save-settings','Save settings','check','primary')}${button('export-config','Export config.json','download','secondary')}</div></div>`);
}
function collectSettings() {
  const value=$('#team-id').value.trim(); const teamId=value ? Number(value) : null;
  if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(teamId) || teamId<=0)) throw new Error('Team ID must be a positive number.');
  return {...config,teamName:$('#team-name').value.trim(),teamId,matchLimit:Number($('#match-limit').value),manualMatches:teamId===config.teamId ? config.manualMatches ?? [] : []};
}
function showHelp() {
  utility('Keyboard shortcuts',`<div class="utility-body shortcuts">${[['/','Search'],['Ctrl / ⌘ K','Search'],['N','New draft'],['J / K','Next / previous draft'],['Enter','Open focused draft'],['1–5','Focus a position in draft view'],['Esc','Close the current dialog'],['?','Show shortcuts']].map(([key,label])=>`<div><span>${label}</span><kbd>${key}</kbd></div>`).join('')}<p class="muted small-text">Tab moves between controls. In the hero picker, use arrow keys to move between heroes and Enter to choose.</p></div>`);
}

document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='search'){query=el.value;renderContent();}
  if(el.id==='hero-search'){picker.search=el.value;renderHeroGrid();}
  if(editor && ['draft-title','draft-tags','draft-description'].includes(el.id)){
    if(el.id==='draft-title') editor.draft.title=el.value;
    if(el.id==='draft-tags') editor.draft.tags=el.value.split(',').map(t=>t.trim()).filter(Boolean);
    if(el.id==='draft-description') editor.draft.description=el.value;
    saveRecovery();
  }
});
document.addEventListener('change',event=>{if(event.target.id==='position-filter'){position=event.target.value;renderContent();}});
$('#import-file').addEventListener('change',event=>{const file=event.target.files[0];if(file)importFile(file);event.target.value='';});
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]'); if(!el || el.disabled)return;
  const a=el.dataset.action, id=el.dataset.id, hero=el.dataset.hero, p=Number(el.dataset.position), i=Number(el.dataset.index);
  if(a==='reload')location.reload();
  else if(a==='view-drafts' || a==='view-matches'){view=a==='view-drafts'?'drafts':'matches';query='';$('#search').value='';renderContent();if(view==='matches')refreshMatches();}
  else if(a.startsWith('filter-')){view='drafts';source=a==='filter-local'?'local':'all';onlyFavorites=a==='filter-favorites';tag='';renderContent();}
  else if(a==='tag'){view='drafts';tag=tag===el.dataset.tag?'':el.dataset.tag;renderContent();}
  else if(a==='clear-filters'){query='';tag='';onlyFavorites=false;source='all';position='';$('#search').value='';$('#position-filter').value='';renderContent();}
  else if(a==='favorite'){favorites.has(id)?favorites.delete(id):favorites.add(id);write('favorites',[...favorites]);renderContent();if($('#detail-dialog').open)showDetail(selectedId,false);}
  else if(a==='detail')showDetail(id);
  else if(a==='close-detail')closeDetail();
  else if(a==='blocked')openPicker('block');
  else if(a==='unblock' || a==='toggle-blocked'){unavailable.has(hero)?unavailable.delete(hero):unavailable.add(hero);refreshAvailability();}
  else if(a==='clear-blocked'){unavailable.clear();refreshAvailability();}
  else if(a==='choose'){
    const next={...locks};const releasing=next[p]===hero;if(releasing)delete next[p];else next[p]=hero;
    if(!releasing && !resolveLineup(getDraft(selectedId),unavailable,next)){toast('That choice conflicts with another locked position or leaves no complete lineup. Release a choice first.',true);return;}
    locks=next;showDetail(selectedId,false);
  }
  else if(a==='reset-locks'){locks={};showDetail(selectedId,false);}
  else if(a==='new')openEditor();
  else if(a==='edit-detail')openEditor(getDraft(selectedId));
  else if(a==='duplicate')openEditor(getDraft(selectedId),true);
  else if(a==='close-editor'){close('#editor-dialog');editor=null;renderNavigation();}
  else if(a==='discard-editor'){
    if(!editor.touched){forget('editor');editor=null;close('#editor-dialog');renderNavigation();return;}
    utility('Discard unfinished changes?',`<div class="utility-body"><p>Your last saved draft is kept. Unfinished editor changes will be removed.</p><div class="button-row">${button('close-utility','Keep editing','','secondary')}${button('confirm-discard','Discard changes','','primary')}</div></div>`);
  }
  else if(a==='confirm-discard'){forget('editor');editor=null;close('#utility-dialog');close('#editor-dialog');renderNavigation();}
  else if(a==='recover'){
    const saved=read('editor',null);
    if(!saved?.draft || !POSITIONS.every(p=>Array.isArray(saved.draft[`pos${p}`]) && saved.draft[`pos${p}`].every(h=>heroMap.has(h)))){toast('The unfinished draft could not be restored.',true);return;}
    closeDetail();editor=saved;renderEditor();open('#editor-dialog');
  }
  else if(a==='save-editor')saveEditor();
  else if(a==='add-hero')openPicker('edit',p);
  else if(a==='remove-hero'){editor.draft[`pos${p}`].splice(i,1);saveRecovery();renderEditor();}
  else if(a==='move'){const list=editor.draft[`pos${p}`],next=i+Number(el.dataset.delta);if(next>=0 && next<list.length){[list[i],list[next]]=[list[next],list[i]];saveRecovery();renderEditor();}}
  else if(a==='close-picker')close('#picker-dialog');
  else if(a==='attribute'){picker.attribute=el.dataset.attribute;$$('[data-action="attribute"]').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',String(b===el));});renderHeroGrid();}
  else if(a==='pick-hero'){
    if(picker.mode==='block'){unavailable.has(hero)?unavailable.delete(hero):unavailable.add(hero);refreshAvailability();renderHeroGrid();$(`[data-hero="${hero}"]`,$('#hero-grid'))?.focus();}
    else {editor.draft[`pos${picker.position}`].push(hero);saveRecovery();close('#picker-dialog');renderEditor();$(`[data-action="add-hero"][data-position="${picker.position}"]`,$('#editor-dialog')).focus();}
  }
  else if(a==='assign-suggestion')utility('Assign position',`<div class="utility-body"><p>${esc(heroMap.get(hero).name)}</p><div class="assign-positions">${POSITIONS.map(pos=>button('assign-position',`<b>${pos}</b>${ROLES[pos-1]}`,'','secondary',`data-position="${pos}" data-hero="${hero}" ${editor.draft[`pos${pos}`].length>=MAX_HEROES?'disabled':''}`)).join('')}</div></div>`);
  else if(a==='assign-position'){editor.draft[`pos${p}`].push(hero);saveRecovery();close('#utility-dialog');renderEditor();}
  else if(a==='export-detail')exportJson(cleanDraft(getDraft(selectedId)),`${selectedId}.json`);
  else if(a==='github-detail')showGithub(getDraft(selectedId));
  else if(a==='remove-local'){
    const d=getDraft(id);const published=repoDrafts.some(r=>r.id===id);
    utility(published?'Discard local edits?':'Remove browser draft?',`<div class="utility-body"><p>${published?'The shared repository version will be shown again.':'This removes the draft from this browser. Export the JSON first if you want to keep it.'}</p><div class="button-row">${button('close-utility','Cancel','','secondary')}${button('export-local','Export JSON','download','secondary',`data-id="${id}"`)}${button('confirm-remove-local','Remove browser copy','','primary',`data-id="${id}"`)}</div></div>`);
  }
  else if(a==='export-local')exportJson(cleanDraft(getDraft(id)),`${id}.json`);
  else if(a==='confirm-remove-local'){
    const next=localDrafts.filter(d=>d.id!==id);if(!write('local',next))return;
    localDrafts=next;close('#utility-dialog');closeDetail();renderContent();toast('Browser copy removed. Repository files are unchanged.');
  }
  else if(a==='copy-json'){try{await navigator.clipboard.writeText(JSON.stringify(cleanDraft(getDraft(id)),null,2)+'\n');toast('JSON copied.');}catch{utility('Draft JSON',`<div class="utility-body"><p>Select and copy the JSON below.</p><textarea class="json-copy" aria-label="Draft JSON" readonly>${esc(JSON.stringify(cleanDraft(getDraft(id)),null,2))}</textarea></div>`);$('.json-copy').select();}}
  else if(a==='import')$('#import-file').click();
  else if(a==='export-all')exportJson(allDrafts().map(cleanDraft),'drafts.json');
  else if(a==='settings')showSettings();
  else if(a==='help')showHelp();
  else if(a==='close-utility')close('#utility-dialog');
  else if(a==='save-settings' || a==='export-config'){
    try{const next=collectSettings();if(a==='export-config'){exportJson(next,'config.json');return;}if(!write('config',next))return;const changed=next.teamId!==config.teamId;config=next;if(changed){matchData=read(`matches:${config.teamId}`,{teamId:config.teamId,matches:[]});matchError='';}close('#utility-dialog');renderShell();toast('Settings saved for this browser.');}
    catch(error){$('#settings-error').hidden=false;$('#settings-error').textContent=error.message;}
  }
  else if(a==='refresh-matches')refreshMatches(true);
  else if(a==='add-match')showAddMatch();
  else if(a==='load-match')addMatch();
  else if(a==='export-matches')exportJson(matchData,'matches.json');
  else if(a==='draft-from-match'){
    const m=matchData.matches.find(m=>m.id===Number(el.dataset.match));const suggestions=m.heroes.map(id=>heroByNumber.get(id)?.id).filter(Boolean);
    openEditor(null,false,suggestions);editor.draft.title=`vs ${m.opponent}`;editor.draft.description=`Match ${m.id} · https://www.opendota.com/matches/${m.id}`;saveRecovery();renderEditor();
  }
});

document.addEventListener('keydown',event=>{
  const el=event.target, typing=el.matches('input,textarea,select,[contenteditable="true"]');
  const topDialog=['#utility-dialog','#picker-dialog','#editor-dialog','#detail-dialog'].find(s=>$(s).open);
  if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k' && !topDialog){event.preventDefault();$('#search')?.focus();return;}
  if(event.key==='Escape' && !topDialog && el.id==='search'){el.value='';query='';renderContent();el.blur();return;}
  if(topDialog==='#picker-dialog' && ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key)){
    const tiles=$$('.hero-tile:not(:disabled)');const current=tiles.indexOf(el);const cols=Math.max(1,Math.round($('#hero-grid').clientWidth/(tiles[0]?.getBoundingClientRect().width+8)));
    if(current>=0 || el.id==='hero-search' && event.key==='ArrowDown'){event.preventDefault();const delta={ArrowDown:cols,ArrowUp:-cols,ArrowLeft:-1,ArrowRight:1}[event.key];tiles[Math.max(0,Math.min(tiles.length-1,current<0?0:current+delta))]?.focus();}return;
  }
  if(typing || event.ctrlKey || event.metaKey || event.altKey)return;
  if(topDialog){if(topDialog==='#detail-dialog' && /^[1-5]$/.test(event.key)){event.preventDefault();$$('.detail-position')[Number(event.key)-1]?.querySelector('.hero-choice:not(:disabled)')?.focus();}return;}
  if(event.key==='/'){event.preventDefault();$('#search')?.focus();}
  else if(event.key.toLowerCase()==='n'){event.preventDefault();openEditor();}
  else if(event.key==='?'){event.preventDefault();showHelp();}
  else if(['j','k'].includes(event.key.toLowerCase()) && view==='drafts'){
    event.preventDefault();const cards=$$('.draft-title');const index=cards.indexOf(document.activeElement);cards[Math.max(0,Math.min(cards.length-1,index+(event.key.toLowerCase()==='j'?1:-1)))]?.focus();
  }
});
$('#detail-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('#editor-dialog').addEventListener('cancel',()=>{editor=null;renderNavigation();});
function readHash(){if(!heroMap)return;const id=location.hash.match(/^#draft\/([a-z0-9-]+)$/)?.[1];if(id){if(getDraft(id))showDetail(id,false);else toast('This draft is not in the shared library or this browser.',true);}else if($('#detail-dialog').open)closeDetail();}
window.addEventListener('popstate',readHash);
window.addEventListener('hashchange',readHash);
window.addEventListener('storage',event=>{if(event.key==='drafts:local'){const values=read('local',[]);if(Array.isArray(values)){localDrafts=values.filter(d=>!validateDraft(d,heroMap).length).map(cleanDraft);renderContent();}}});
await boot();
