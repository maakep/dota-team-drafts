import { POSITIONS, ROLES, MAX_HEROES, MAX_BANS, MATCH_LIMIT, ATTRIBUTES, validateDraft, cleanDraft, normalizeText, matchesSearch, pickedFit, resolveLineup, preferredLineup, draftHash, parseDraftHash, lineupText, githubCreateUrl } from './domain.js';
import { loadTeamMatches, loadSingleMatch } from './opendota.js';
import { publishingToken, submitDraft } from './publishing.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5"/>',
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
function write(key, value) { try { localStorage.setItem(`drafts:${key}`, JSON.stringify(value)); return true; } catch { toast('Could not save changes in this browser.', true); return false; } }
function forget(key) { try { localStorage.removeItem(`drafts:${key}`); } catch {} }
let config, baseConfig, publishing, heroes, heroMap, heroByNumber, repoDrafts, localDrafts = [], favorites = new Set();
let view = 'drafts', query = '', onlyFavorites = false;
let unavailable = new Set(), picked = new Set(), choices = {}, selectedId = null, editor = null, picker = null, busy = false, matchData, matchError = '', savingId = null;
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
    const responses = await Promise.all(['config','heroes','drafts','matches','publishing'].map(async file => {
      const response = await fetch(`./data/${file}.json`,{cache:'no-cache'});
      if (!response.ok) throw new Error(`Could not load ${file}.json.`);
      return response.json();
    }));
    [baseConfig, heroes, repoDrafts, matchData, publishing] = responses;
    config = { ...baseConfig };
    heroMap = new Map(heroes.map(h => [h.id, h])); heroByNumber = new Map(heroes.map(h => [h.heroId, h]));
    const saved = read('local', []);
    localDrafts = Array.isArray(saved) ? saved.filter(d => !validateDraft(d, heroMap).length).map(cleanDraft) : [];
    if (!Array.isArray(saved) || saved.length !== localDrafts.length) storageWarnings.push('Some saved drafts could not be loaded.');
    const pinned = read('favorites', []); favorites = new Set(Array.isArray(pinned) ? pinned.filter(id => typeof id === 'string') : []);
    const blocked = read('unavailable', []); unavailable = new Set(Array.isArray(blocked) ? blocked.filter(h => heroMap.has(h)) : []);
    const own = read('picked', []); picked = new Set(Array.isArray(own) ? own.filter(h=>heroMap.has(h)).slice(0,5) : []);
    for(const id of picked) unavailable.delete(id);
    const cached = read(`matches:${config.teamId}`, null);
    if (matchData.teamId !== config.teamId) matchData = { teamId: config.teamId, matches: [] };
    if (cached?.teamId === config.teamId && Array.isArray(cached.matches)) {
      const cachedIsNewer = Date.parse(cached.updatedAt || '') > Date.parse(matchData.updatedAt || '');
      const combined = new Map((cachedIsNewer ? [...matchData.matches,...cached.matches] : [...cached.matches,...matchData.matches]).map(m=>[m.id,m]));
      matchData = {...(cachedIsNewer ? cached : matchData),matches:[...combined.values()].sort((a,b)=>b.id-a.id).slice(0,MATCH_LIMIT)};
    }
    renderShell();
    readHash();
    if(!$('#detail-dialog').open) $('#search').focus({preventScroll:true});
    if (storageWarnings.length) toast(storageWarnings.join(' '), true);
  } catch (error) {
    $('#app').innerHTML = `<main class="load-error"><h1>Drafts could not load</h1><p>${esc(error.message)}</p><p>Serve the built site with <code>npm run dev</code>.</p>${button('reload','Try again','refresh','primary')}</main>`;
  }
}

function renderShell() {
  document.title = `Drafts · ${config.teamName || 'dota-team-drafts'}`;
  $('#app').innerHTML = `<main id="main" tabindex="-1" class="main">
    <h1 id="page-title" class="sr-only">Drafts</h1>
    <header class="workspace-header"><nav class="tabs" aria-label="Main navigation">
      ${button('view-drafts','Drafts','grid','nav-button',`data-view="drafts"`)}
      ${button('view-matches','Matches','history','nav-button',`data-view="matches"`)}
      ${iconButton('filter-favorites','Starred drafts','star','nav-button',`aria-pressed="false"`)}
    </nav><div id="header-actions"></div></header>
    <div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search drafts, heroes, tags…" autocomplete="off" aria-label="Search drafts, heroes and tags"></label></div>
    <div id="session-bar" class="session-bar"></div>
    <section id="content" aria-label="Draft library"></section>
    <footer class="main-footer"><span id="result-count" aria-live="polite"></span></footer>
  </main><div id="recovery" class="recovery-toast" hidden></div>`;
  $('#search').value = query;
  renderNavigation(); renderContent();
}
function renderNavigation() {
  const recovery = $('#recovery');
  recovery.hidden = !read('editor',null) || $('#editor-dialog').open;
  recovery.innerHTML = `${button('recover','Continue editing','edit','recovery-button')}${iconButton('discard-recovery','Discard unfinished draft','close')}`;
  const favorite = $('[data-action="filter-favorites"]');
  favorite.classList.toggle('active',view==='drafts' && onlyFavorites);favorite.setAttribute('aria-pressed',String(onlyFavorites));
  $$('[data-view]').forEach(el => { const active = el.dataset.view === view && !onlyFavorites; el.classList.toggle('active',active); if (active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
}
function renderSessionBar() {
  const el = $('#session-bar');
  el.innerHTML = `<div class="hero-state-group">${button('blocked','Unavailable heroes','ban','unavailable-button')}
    <div class="blocked-chips">${[...unavailable].map(id => button('unblock',`${portrait(id)}<span>${esc(heroMap.get(id).name)}</span>${icon('close')}`,'','blocked-chip',`data-hero="${id}" aria-label="Make ${esc(heroMap.get(id).name)} available"`)).join('')}</div>
    ${unavailable.size ? iconButton('clear-blocked','Clear unavailable heroes','close') : ''}</div>
    <div class="hero-state-group">${button('picked','Our picks','check','picked-button')}
    <div class="picked-chips">${[...picked].map(id=>button('unpick',`${portrait(id)}<span>${esc(heroMap.get(id).name)}</span>${icon('close')}`,'','picked-chip',`data-hero="${id}" aria-label="Remove ${esc(heroMap.get(id).name)} from our picks"`)).join('')}</div>
    ${picked.size ? iconButton('clear-picked','Clear our picks','close') : ''}</div>`;
  el.hidden = view !== 'drafts';
}
function filteredDrafts() {
  return allDrafts().filter(d => (!onlyFavorites || favorites.has(d.id)) && matchesSearch(d,query,heroMap)).sort((a,b) => pickedFit(b,picked).count-pickedFit(a,picked).count || Number(favorites.has(b.id))-Number(favorites.has(a.id)) || a.title.localeCompare(b.title));
}
function renderContent() {
  const focus = rememberFocus(document.body);
  renderNavigation(); renderSessionBar();
  $('#page-title').textContent = view === 'drafts' ? 'Drafts' : 'Matches';
  $('#search').placeholder = view === 'drafts' ? 'Search drafts, heroes, tags…' : 'Search opponents, heroes, match IDs…';
  $('#search').setAttribute('aria-label',view === 'drafts' ? 'Search drafts, heroes and tags' : 'Search match history');
  $('#header-actions').innerHTML = view === 'drafts' ? button('new','New draft','plus','primary') : `${iconButton('add-match','Add match','plus','secondary')}${iconButton('refresh-matches',busy ? 'Loading matches' : 'Refresh matches','refresh','secondary',busy ? 'disabled' : '')}`;
  if (view === 'matches') { renderMatches(); restoreFocus(document.body,focus); return; }
  const drafts = filteredDrafts();
  $('#result-count').textContent = query || onlyFavorites ? `${drafts.length} drafts` : '';
  $('#content').setAttribute('aria-label','Draft library');
  $('#content').innerHTML = `${query || onlyFavorites ? `<div class="filter-summary">${button('clear-filters','Clear search','close','text-button')}</div>` : ''}
    ${drafts.length ? `<div class="draft-list">${drafts.map(renderCard).join('')}</div>` : `<div class="empty-state">${icon('search')}<h2>${allDrafts().length ? 'No drafts found' : 'No drafts yet'}</h2>${button(allDrafts().length ? 'clear-filters' : 'new',allDrafts().length ? 'Clear filters' : 'New draft','plus','secondary')}</div>`}`;
  restoreFocus(document.body,focus);
}
function renderCard(d, index) {
  const lineup = resolveLineup(d,unavailable);
  const starred = favorites.has(d.id);
  const fit = pickedFit(d,picked);
  return `<article class="draft-card ${unavailable.size && !lineup ? 'no-lineup' : ''}">
    <header class="card-header"><h2>${button('detail',esc(d.title),'','draft-title',`data-id="${d.id}"`)}</h2><div class="card-tags">${(d.tags ?? []).filter(t => t !== 'example').slice(0,3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${d._source !== 'repo' ? '<span class="local-label">Unsaved</span>' : d.tags?.includes('example') ? '<span class="example-label">Example</span>' : ''}
      ${picked.size ? `<span class="picked-fit ${fit.count===fit.total ? 'complete' : ''}" title="${esc(fit.missing.length ? `Missing: ${fit.missing.map(id=>heroMap.get(id).name).join(', ')}` : 'Contains all our picks')}">${fit.count}/${fit.total} picked</span>` : ''}
      ${iconButton('favorite',starred ? 'Unstar draft' : 'Star draft','star',starred ? 'starred' : '',`data-id="${d.id}" aria-pressed="${starred}"`)}
    </header>
    <button type="button" data-action="detail" data-id="${d.id}" class="lineup-button" aria-label="Open ${esc(d.title)}">
      ${POSITIONS.map(p => {
        const ids = d[`pos${p}`]; const current = lineup?.[p] || ids.find(h => !unavailable.has(h)) || ids[0];
        return `<div class="position-preview" data-position="${p}"><div class="position-label"><b>${p}</b><span>${ROLES[p-1]}</span>${current !== ids[0] ? '<span class="backup-label">Backup</span>' : ''}</div><div class="primary-portrait ${unavailable.has(current) ? 'is-unavailable' : ''} ${picked.has(current) ? 'is-picked' : ''}">${portrait(current,'',index < 3)}<span>${esc(heroMap.get(current).name)}</span></div><div class="backup-previews">${ids.filter(id => id !== current).map(id => `<span class="mini-portrait ${unavailable.has(id) ? 'is-unavailable' : ''} ${picked.has(id) ? 'is-picked' : ''}">${portrait(id)}<small>${ids.indexOf(id)+1}</small></span>`).join('')}</div></div>`;
      }).join('')}
    </button>
    ${d.description || unavailable.size && !lineup ? `<footer class="card-footer">${d.description ? `<p>${esc(d.description.replace(/^Example draft\. /,''))}</p>` : ''}${unavailable.size && !lineup ? `<span class="card-status warning">${icon('ban')}No lineup available</span>` : ''}</footer>` : ''}
  </article>`;
}

function showDetail(id, updateHash = true, sharedChoices = null) {
  const d = getDraft(id); if (!d) return;
  const focus = rememberFocus($('#detail-dialog'));
  if (sharedChoices && Object.keys(sharedChoices).length) {
    const shared = resolveLineup(d, new Set(), sharedChoices);
    if (shared) choices = shared;
    else { choices = resolveLineup(d,unavailable) || {}; toast('This lineup is no longer available in the draft.',true); }
  } else if (selectedId !== id) choices = resolveLineup(d,unavailable) || {};
  selectedId = id;
  const lineup = POSITIONS.every(p=>choices[p]) ? resolveLineup(d,new Set(),choices) : null;
  const available = lineup && Object.values(lineup).every(hero => !unavailable.has(hero));
  $('#detail-dialog').innerHTML = `<header class="dialog-header detail-header"><h2 id="detail-title">${esc(d.title)}</h2><div class="button-row">${iconButton('favorite',favorites.has(id) ? 'Unstar draft' : 'Star draft','star',favorites.has(id) ? 'starred' : '',`data-id="${id}"`)}${button('edit-detail','Edit','edit','secondary')}${iconButton('close-detail','Close draft (Esc)','close')}</div></header>
    ${d.description ? `<p class="detail-description">${esc(d.description)}</p>` : ''}
    ${d.bans?.length ? `<div class="draft-bans"><span>Bans:</span>${d.bans.map(id=>`<span class="ban-portrait">${portrait(id)}</span>`).join('')}</div>` : ''}
    <div class="detail-toolbar"><div class="button-row">${button('blocked','Unavailable heroes','ban','secondary')}${unavailable.size ? button('clear-blocked','Clear','','text-button') : ''}</div>${!available ? '<span class="lineup-status warning">No lineup available</span>' : ''}</div>
    <div class="detail-positions">${POSITIONS.map(p => {
      const current = choices[p] || d[`pos${p}`].find(h => !unavailable.has(h));
      return `<section class="detail-position" data-position="${p}"><h3><b>${p}</b>${ROLES[p-1]}</h3><div class="detail-primary ${!current || unavailable.has(current) ? 'is-unavailable' : ''}">${portrait(current || d[`pos${p}`][0],'',true)}<strong>${esc(heroMap.get(current)?.name || 'Unavailable')}</strong></div><div class="hero-options">${d[`pos${p}`].map((hero,i) => `<div class="hero-option ${current === hero ? 'selected' : ''} ${unavailable.has(hero) ? 'is-unavailable' : ''}"><button class="hero-choice" type="button" data-action="choose" data-position="${p}" data-hero="${hero}" aria-pressed="${current === hero}" ${unavailable.has(hero) ? 'disabled' : ''}><span class="priority">${i+1}</span>${portrait(hero)}<span>${esc(heroMap.get(hero).name)}</span>${current === hero ? icon('check') : ''}</button>${iconButton('toggle-blocked',unavailable.has(hero) ? `Make ${heroMap.get(hero).name} available` : `Mark ${heroMap.get(hero).name} unavailable`,'ban',unavailable.has(hero) ? 'blocked' : '',`data-hero="${hero}" aria-pressed="${unavailable.has(hero)}"`)}</div>`).join('')}</div></section>`;
    }).join('')}</div>
    <footer class="dialog-footer">${button('duplicate','Duplicate','copy','secondary')}<div class="button-row">${button('copy-lineup','Copy lineup','copy','secondary',lineup ? '' : 'disabled')}${button('github-detail',savingId===id ? 'Saving…' : 'Save to GitHub','external','primary',savingId ? 'disabled' : '')}</div></footer>`;
  open('#detail-dialog');
  restoreFocus($('#detail-dialog'),focus);
  if (updateHash) history.pushState({},'',draftHash(id,choices));
}
function refreshAvailability() {
  write('unavailable',[...unavailable]);
  write('picked',[...picked]);
  if (selectedId) choices = preferredLineup(getDraft(selectedId),choices,unavailable) || {};
  renderContent();
  if ($('#detail-dialog').open) { showDetail(selectedId,false); history.replaceState({},'',draftHash(selectedId,choices)); }
}
function closeDetail() {
  close('#detail-dialog'); selectedId = null; choices = {};
  if (location.hash.startsWith('#draft/')) history.replaceState({},'',location.pathname+location.search);
  $('#search')?.focus({preventScroll:true});
}

function openEditor(draft = null, duplicate = false, suggestions = []) {
  editor = {
    draft: draft ? cleanDraft(draft) : {id:'',title:'',description:'',tags:[],...Object.fromEntries(POSITIONS.map(p => [`pos${p}`,[]]))},
    target: duplicate ? null : draft?.id || null,
    suggestions,
    touched: false,
  };
  if (duplicate) { editor.draft.id = ''; editor.draft.title += ' (copy)'; }
  closeDetail(); renderEditor(); open('#editor-dialog'); renderNavigation(); $('#draft-title').focus();
}
function saveRecovery() {
  if (!editor) return;
  editor.touched = true;
  write('editor',editor);
  renderNavigation();
}
function renderEditor() {
  const focus = rememberFocus($('#editor-dialog'));
  const d = editor.draft;
  $('#editor-dialog').innerHTML = `<header class="dialog-header"><h2 id="editor-title">${editor.target ? 'Edit draft' : 'New draft'}</h2>${iconButton('close-editor','Close editor','close')}</header>
    <div class="editor-fields"><label>Title<input id="draft-title" maxlength="100" placeholder="Draft name" value="${esc(d.title)}" autocomplete="off"></label><label>Tags <span class="optional">comma separated</span><input id="draft-tags" value="${esc((d.tags ?? []).join(', '))}" placeholder="teamfight, comfort" autocomplete="off"></label><label class="description-field">Notes <span class="optional">optional</span><textarea id="draft-description" maxlength="3000" rows="2" placeholder="Timings, lanes, or things to remember">${esc(d.description)}</textarea></label></div>
    ${editor.suggestions?.length ? `<div class="suggestions"><span>Match heroes · assign positions</span>${editor.suggestions.filter(id => !POSITIONS.some(p => d[`pos${p}`].includes(id))).map(id => button('assign-suggestion',`${portrait(id)}${esc(heroMap.get(id)?.name)}`,'','suggested-hero',`data-hero="${id}"`)).join('')}</div>` : ''}
    <div class="editor-positions">${POSITIONS.map(p => `<section class="editor-position" data-position="${p}"><h3><b>${p}</b>${ROLES[p-1]}</h3><ol class="editable-heroes">${d[`pos${p}`].map((id,i) => `<li><div class="editable-hero-image">${portrait(id)}<span>${i === 0 ? 'Primary' : `Backup ${i}`}</span></div><div class="editable-hero-name">${esc(heroMap.get(id).name)}</div><div class="reorder-tools">${iconButton('move',`Move ${heroMap.get(id).name} up`,'up','',`data-position="${p}" data-index="${i}" data-delta="-1" ${i===0 ? 'disabled' : ''}`)}${iconButton('move',`Move ${heroMap.get(id).name} down`,'down','',`data-position="${p}" data-index="${i}" data-delta="1" ${i===d[`pos${p}`].length-1 ? 'disabled' : ''}`)}${iconButton('remove-hero',`Remove ${heroMap.get(id).name}`,'close','remove-hero',`data-position="${p}" data-index="${i}"`)}</div></li>`).join('')}</ol>${button('add-hero',d[`pos${p}`].length ? 'Add backup' : 'Add hero','plus',`add-hero ${!d[`pos${p}`].length ? 'empty-slot' : ''}`,`data-position="${p}" ${d[`pos${p}`].length >= MAX_HEROES ? 'disabled' : ''}`)}</section>`).join('')}</div>
    <div class="editor-bans"><span>Bans:</span>${(d.bans ?? []).map(id=>`<span class="editable-ban">${portrait(id)}${iconButton('remove-ban',`Remove ${heroMap.get(id).name}`,'close','',`data-hero="${id}"`)}</span>`).join('')}${button('add-ban','Add ban','plus','text-button')}</div>
    <div id="editor-errors" class="form-errors" role="alert" hidden></div><footer class="dialog-footer">${button('discard-editor','Discard','','text-button')}<div class="button-row">${editor.target && localDrafts.some(d=>d.id===editor.target) ? button('remove-local','Discard saved changes','','text-button',`data-id="${editor.target}"`) : ''}${button('save-editor','Done','check','primary')}</div></footer>`;
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
  localDrafts = next; forget('editor'); editor=null; close('#editor-dialog'); renderContent(); showDetail(saved.id);
}

function openPicker(mode, p = null) {
  picker = { mode, position:p, search:'', attribute:'' };
  $('#picker-dialog').innerHTML = `<header class="dialog-header"><h2 id="picker-title">${mode === 'block' ? 'Unavailable heroes' : mode === 'picked' ? 'Our picks' : mode === 'bans' ? 'Bans' : `Add hero · Position ${p}`}</h2>${iconButton('close-picker','Close hero picker','close')}</header><label class="search picker-search">${icon('search')}<input id="hero-search" type="search" placeholder="Find a hero…" aria-label="Find a hero" autocomplete="off" autofocus></label><div class="attribute-filters">${[['','All'],...ATTRIBUTES].map(([attr,label]) => button('attribute',label,'',`attribute-filter ${!attr ? 'active' : ''}`,`data-attribute="${attr}" aria-pressed="${!attr}"`)).join('')}</div><div id="hero-grid" class="hero-grid" aria-label="Heroes"></div>`;
  renderHeroGrid(); open('#picker-dialog'); $('#hero-search').focus();
}
function renderHeroGrid() {
  const list = heroes.filter(h => (!picker.attribute || h.attribute === picker.attribute) && normalizeText([h.name,h.id,...h.aliases].join(' ')).includes(normalizeText(picker.search)));
  $('#hero-grid').innerHTML = list.length ? ATTRIBUTES.map(([attribute,label]) => {
    const group = list.filter(h => h.attribute === attribute);
    if (!group.length) return '';
    return `<section class="attribute-group" data-attribute="${attribute}" aria-label="${label}"><h3>${label}</h3><div class="hero-group-grid">${group.map(h => {
      const selected = picker.mode === 'block' ? unavailable : picker.mode==='picked' ? picked : new Set(picker.mode === 'bans' ? editor.draft.bans ?? [] : editor.draft[`pos${picker.position}`]);
      const chosen = selected.has(h.id);
      const full = picker.mode === 'bans' ? selected.size >= MAX_BANS : picker.mode==='picked' ? selected.size>=5 : picker.mode === 'edit' && selected.size >= MAX_HEROES;
      const disabled = picker.mode === 'edit' && chosen || picker.mode !== 'block' && !chosen && full;
      return `<button type="button" class="hero-tile ${chosen ? 'chosen' : ''} ${picker.mode === 'block' && chosen ? 'is-unavailable' : ''} ${picker.mode==='picked' && chosen ? 'is-picked' : ''}" data-action="pick-hero" data-hero="${h.id}" aria-label="${esc(h.name)}" aria-pressed="${chosen}" ${disabled ? 'disabled' : ''}><div class="hero-tile-picture">${portrait(h.id)}</div><span class="hero-tile-name">${esc(h.name)}</span>${chosen ? `<b>${icon(picker.mode === 'block' ? 'ban' : 'check')}</b>` : ''}</button>`;
    }).join('')}</div></section>`;
  }).join('') : '<p class="grid-empty">No matching heroes.</p>';
}
function pickHero(hero, force = false) {
  if (!heroMap.has(hero)) return;
  if (picker.mode === 'block') {
    if (!force && unavailable.has(hero)) unavailable.delete(hero); else unavailable.add(hero);
    picked.delete(hero);
    refreshAvailability();
  } else if (picker.mode==='picked') {
    if(!force && picked.has(hero)) picked.delete(hero);
    else if(picked.size<5) {picked.add(hero);unavailable.delete(hero);}
    refreshAvailability();
  } else if (picker.mode === 'bans') {
    const bans = editor.draft.bans ?? [];
    if (bans.includes(hero)) editor.draft.bans = bans.filter(id => id !== hero);
    else if (bans.length < MAX_BANS) editor.draft.bans = [...bans,hero];
    saveRecovery(); renderEditor();
  } else {
    const list = editor.draft[`pos${picker.position}`];
    if (!list.includes(hero) && list.length < MAX_HEROES) list.push(hero);
    saveRecovery(); renderEditor();
  }
  renderHeroGrid(); $('#hero-search').focus(); $('#hero-search').select();
}
function closePicker() {
  close('#picker-dialog');
  const root = picker.mode === 'block' || picker.mode==='picked' ? ($('#detail-dialog').open ? $('#detail-dialog') : document) : $('#editor-dialog');
  const selector = picker.mode === 'edit' ? `[data-action="add-hero"][data-position="${picker.position}"]` : picker.mode === 'bans' ? '[data-action="add-ban"]' : picker.mode==='picked' ? '[data-action="picked"]' : '[data-action="blocked"]';
  const target = $(selector,root);
  (target && !target.disabled ? target : $('#draft-title') || $('[data-action="close-detail"]'))?.focus(); picker = null;
}
async function copyText(text, label = 'Lineup') {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied.`); }
  catch { utility(`Copy ${label.toLowerCase()}`,`<div class="utility-body"><textarea class="clipboard-text" aria-label="${esc(label)}" readonly>${esc(text)}</textarea></div>`); $('.clipboard-text').select(); }
}
function showGithub(d) {
  const existing = repoDrafts.some(r => r.id === d.id);
  const url = existing ? `https://github.com/${config.repository}/edit/${encodeURIComponent(config.branch)}/data/drafts/${d.id}.json` : githubCreateUrl(config,d);
  const tooLong = url?.length > 12000;
  const fallback = `https://github.com/${config.repository}/new/${encodeURIComponent(config.branch)}?filename=${encodeURIComponent(`data/drafts/${d.id}.json`)}`;
  utility('Save to GitHub',`<div class="utility-body"><p>${existing || tooLong ? 'Copy the JSON and replace the file contents on GitHub.' : 'Review and commit the draft on GitHub.'}</p><div class="button-row">${existing || tooLong ? button('copy-json','Copy JSON','copy','secondary',`data-id="${d.id}"`) : ''}<a class="button primary" href="${esc(tooLong ? fallback : url)}" target="_blank" rel="noopener noreferrer">${icon('external')}Open GitHub</a></div></div>`);
}
async function saveGithub(draft) {
  if(savingId)return;
  if(!publishingToken(publishing)){showGithub(draft);return;}
  const saved=cleanDraft(draft);
  savingId=saved.id;
  if($('#detail-dialog').open)showDetail(selectedId,false);
  try {
    await submitDraft(config,publishing,saved,repoDrafts.find(d=>d.id===saved.id));
    repoDrafts=[...repoDrafts.filter(d=>d.id!==saved.id),saved];
    localDrafts=localDrafts.filter(d=>d.id!==saved.id || JSON.stringify(cleanDraft(d))!==JSON.stringify(saved));
    write('local',localDrafts);toast('Saved to GitHub.');
  } catch(error) {toast(error.message,true);}
  finally {savingId=null;renderContent();if($('#detail-dialog').open)showDetail(selectedId,false);}
}

function renderMatches() {
  const list = matchData.matches.filter(m => normalizeText([m.id,m.opponent,m.league,...(m.heroes ?? []).map(id => heroByNumber.get(id)?.name)].join(' ')).includes(normalizeText(query)));
  $('#result-count').textContent = `${list.length} matches`;
  $('#content').setAttribute('aria-label','Team match history');
  $('#content').innerHTML = `${matchError ? `<div class="notice error-notice" role="alert">${esc(matchError)}</div>` : ''}${busy ? '<div class="notice" id="match-progress" role="status">Loading matches…</div>' : ''}
    ${matchData.warnings?.length && !matchError ? `<div class="notice">Some OpenDota data was unavailable. ${esc(matchData.warnings[0])}</div>` : ''}
    ${list.length ? `<div class="matches-list">${list.map(m => `<article class="match-card"><header><div><span class="result ${m.won === true ? 'won' : m.won === false ? 'lost' : ''}">${m.won === true ? 'WIN' : m.won === false ? 'LOSS' : '—'}</span><h2>vs ${esc(m.opponent)}</h2></div><span class="muted">${m.startTime ? new Date(m.startTime*1000).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : ''}</span></header><div class="match-lineups"><section><h3>Our heroes <span>${m.radiant ? 'Radiant' : 'Dire'}</span></h3><div class="match-heroes">${m.heroes?.length ? m.heroes.map(numberedPortrait).join('') : '<span class="muted">Hero data unavailable</span>'}</div></section><span class="versus">vs</span><section><h3>${esc(m.opponent)}</h3><div class="match-heroes">${m.opponents?.length ? m.opponents.map(numberedPortrait).join('') : '<span class="muted">Hero data unavailable</span>'}</div></section></div><footer><span class="muted">${esc(m.league)} ${m.duration ? `· ${Math.floor(m.duration/60)}:${String(m.duration%60).padStart(2,'0')}` : ''} · ${m.id}</span><div class="button-row">${m.heroes?.length === 5 ? button('draft-from-match','Create draft','plus','text-button',`data-match="${m.id}"`) : ''}<a href="https://www.opendota.com/matches/${m.id}" target="_blank" rel="noopener noreferrer" class="text-button">OpenDota ${icon('external')}</a></div></footer></article>`).join('')}</div>` : `<div class="empty-state">${icon('history')}<h2>${query ? 'No matches found' : busy ? 'Loading match history' : 'No tracked matches yet'}</h2><p>${query ? 'Try another opponent, hero, or match ID.' : 'OpenDota may not index this team’s amateur or private lobbies. Try a match ID directly.'}</p><div class="button-row">${button('add-match','Add match ID','plus','secondary')}${query ? button('clear-filters','Clear search','','text-button') : ''}</div></div>`}
    `;
}
async function refreshMatches(force = false) {
  if (busy || !config.teamId) return;
  if (!force && matchData.updatedAt && Date.now()-Date.parse(matchData.updatedAt)<30*60*1000) return;
  busy=true; matchError=''; renderContent();
  try {
    matchData = await loadTeamMatches(config,{previous:matchData,onProgress:(done,total) => { const el=$('#match-progress'); if (el) el.textContent=`Loading matches · ${done} of ${total}`; }});
    write(`matches:${config.teamId}`,matchData);
    if (!config.teamName && matchData.teamName) { config.teamName=matchData.teamName; renderShell(); }
  } catch (error) { matchError=error.message; }
  finally { busy=false; if (view==='matches') renderContent(); }
}
function showAddMatch() {
  utility('Add a match',`<div class="utility-body"><label>Match ID<input id="match-id" type="text" inputmode="numeric" pattern="[0-9]+" placeholder="9082244244" autocomplete="off"></label><label>Our side<select id="match-side"><option value="">Detect from team ID</option><option value="radiant">Radiant</option><option value="dire">Dire</option></select></label><p id="match-add-error" class="form-errors" role="alert" hidden></p>${button('load-match','Load match','download','primary')}</div>`);
  $('#match-id').focus();
}
async function addMatch() {
  const id = Number($('#match-id').value.trim()); const side = $('#match-side').value; const el=$('[data-action="load-match"]'); el.disabled=true; el.textContent='Loading…';
  try {
    const match=await loadSingleMatch(id,config.teamId,side);
    if (!match.heroes.length) throw new Error('No hero picks are available for this match.');
    const nextData={...matchData,teamId:config.teamId,updatedAt:new Date().toISOString(),matches:[...matchData.matches.filter(m=>m.id!==match.id),match].sort((a,b)=>b.id-a.id)};
    if (!write(`matches:${config.teamId}`,nextData)) return;
    matchData=nextData; close('#utility-dialog'); view='matches'; renderContent();
  } catch (error) { $('#match-add-error').hidden=false; $('#match-add-error').textContent=`${error.message} If team detection failed, select Radiant or Dire.`; }
  finally { if(el.isConnected) {el.disabled=false;el.textContent='Load match';} }
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
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]'); if(!el || el.disabled)return;
  const a=el.dataset.action, id=el.dataset.id, hero=el.dataset.hero, p=Number(el.dataset.position), i=Number(el.dataset.index);
  if(a==='reload')location.reload();
  else if(a==='view-drafts' || a==='view-matches'){view=a==='view-drafts'?'drafts':'matches';query='';onlyFavorites=false;$('#search').value='';renderContent();$('#search').focus();if(view==='matches')refreshMatches();}
  else if(a==='filter-favorites'){view='drafts';onlyFavorites=!onlyFavorites;renderContent();$('#search').focus();}
  else if(a==='clear-filters'){query='';onlyFavorites=false;$('#search').value='';renderContent();$('#search').focus();}
  else if(a==='favorite'){favorites.has(id)?favorites.delete(id):favorites.add(id);write('favorites',[...favorites]);renderContent();if($('#detail-dialog').open)showDetail(selectedId,false);}
  else if(a==='detail')showDetail(id);
  else if(a==='close-detail')closeDetail();
  else if(a==='blocked')openPicker('block');
  else if(a==='picked')openPicker('picked');
  else if(a==='unpick'){picked.delete(hero);refreshAvailability();}
  else if(a==='clear-picked'){picked.clear();refreshAvailability();}
  else if(a==='unblock' || a==='toggle-blocked'){unavailable.has(hero)?unavailable.delete(hero):unavailable.add(hero);refreshAvailability();}
  else if(a==='clear-blocked'){unavailable.clear();refreshAvailability();}
  else if(a==='choose'){
    const next=preferredLineup(getDraft(selectedId),choices,unavailable,{[p]:hero});
    if(!next){toast('No complete lineup is available with that hero.',true);return;}
    choices=next;showDetail(selectedId,false);history.replaceState({},'',draftHash(selectedId,choices));
  }
  else if(a==='new')openEditor();
  else if(a==='edit-detail')openEditor(getDraft(selectedId));
  else if(a==='duplicate')openEditor(getDraft(selectedId),true);
  else if(a==='close-editor'){close('#editor-dialog');editor=null;renderNavigation();}
  else if(a==='discard-editor'){
    if(!editor.touched){forget('editor');editor=null;close('#editor-dialog');renderNavigation();return;}
    utility('Discard unfinished changes?',`<div class="utility-body"><p>Your last saved draft is kept. Unfinished editor changes will be removed.</p><div class="button-row">${button('close-utility','Keep editing','','secondary')}${button('confirm-discard','Discard changes','','primary')}</div></div>`);
  }
  else if(a==='confirm-discard'){forget('editor');editor=null;close('#utility-dialog');close('#editor-dialog');renderNavigation();}
  else if(a==='discard-recovery'){forget('editor');renderNavigation();$('#search').focus();}
  else if(a==='recover'){
    const saved=read('editor',null);
    if(!saved?.draft || !POSITIONS.every(p=>Array.isArray(saved.draft[`pos${p}`]) && saved.draft[`pos${p}`].every(h=>heroMap.has(h)))){toast('The unfinished draft could not be restored.',true);return;}
    closeDetail();editor=saved;renderEditor();open('#editor-dialog');renderNavigation();$('#draft-title').focus();
  }
  else if(a==='save-editor')saveEditor();
  else if(a==='add-hero')openPicker('edit',p);
  else if(a==='add-ban')openPicker('bans');
  else if(a==='remove-ban'){editor.draft.bans=editor.draft.bans.filter(id=>id!==hero);saveRecovery();renderEditor();}
  else if(a==='remove-hero'){editor.draft[`pos${p}`].splice(i,1);saveRecovery();renderEditor();}
  else if(a==='move'){const list=editor.draft[`pos${p}`],next=i+Number(el.dataset.delta);if(next>=0 && next<list.length){[list[i],list[next]]=[list[next],list[i]];saveRecovery();renderEditor();}}
  else if(a==='close-picker')closePicker();
  else if(a==='attribute'){picker.attribute=el.dataset.attribute;$$('[data-action="attribute"]').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',String(b===el));});renderHeroGrid();}
  else if(a==='pick-hero')pickHero(hero);
  else if(a==='assign-suggestion')utility('Assign position',`<div class="utility-body"><p>${esc(heroMap.get(hero).name)}</p><div class="assign-positions">${POSITIONS.map(pos=>button('assign-position',`<b>${pos}</b>${ROLES[pos-1]}`,'','secondary',`data-position="${pos}" data-hero="${hero}" ${editor.draft[`pos${pos}`].length>=MAX_HEROES?'disabled':''}`)).join('')}</div></div>`);
  else if(a==='assign-position'){editor.draft[`pos${p}`].push(hero);saveRecovery();close('#utility-dialog');renderEditor();}
  else if(a==='copy-lineup'){try{await copyText(lineupText(location.href,getDraft(selectedId),choices,heroMap));}catch(error){toast(error.message,true);}}
  else if(a==='github-detail')saveGithub(getDraft(selectedId));
  else if(a==='remove-local'){
    const published=repoDrafts.some(r=>r.id===id);
    utility('Discard saved changes?',`<div class="utility-body"><p>${published?'Restore the draft from GitHub?':'Remove this draft?'}</p><div class="button-row">${button('close-utility','Cancel','','secondary')}${button('confirm-remove-local','Discard','','primary',`data-id="${id}"`)}</div></div>`);
  }
  else if(a==='confirm-remove-local'){
    const next=localDrafts.filter(d=>d.id!==id);if(!write('local',next))return;
    localDrafts=next;forget('editor');editor=null;close('#utility-dialog');close('#editor-dialog');closeDetail();renderContent();
  }
  else if(a==='copy-json')await copyText(JSON.stringify(cleanDraft(getDraft(id)),null,2)+'\n','JSON');
  else if(a==='close-utility')close('#utility-dialog');
  else if(a==='refresh-matches')refreshMatches(true);
  else if(a==='add-match')showAddMatch();
  else if(a==='load-match')addMatch();
  else if(a==='draft-from-match'){
    const m=matchData.matches.find(m=>m.id===Number(el.dataset.match));const suggestions=m.heroes.map(id=>heroByNumber.get(id)?.id).filter(Boolean);
    openEditor(null,false,suggestions);editor.draft.title=`vs ${m.opponent}`;editor.draft.description=`Match ${m.id} · https://www.opendota.com/matches/${m.id}`;saveRecovery();renderEditor();
  }
});

document.addEventListener('keydown',event=>{
  const el=event.target, typing=el.matches('input,textarea,select,[contenteditable="true"]');
  const topDialog=['#utility-dialog','#picker-dialog','#editor-dialog','#detail-dialog'].find(s=>$(s).open);
  if(topDialog==='#picker-dialog' && el.id==='hero-search' && event.key==='Enter' && !event.isComposing){
    event.preventDefault();const first=$$('.hero-tile:not(:disabled)').find(tile=>picker.mode==='block' ? !unavailable.has(tile.dataset.hero) : picker.mode==='picked' ? !picked.has(tile.dataset.hero) : picker.mode==='bans' ? !editor.draft.bans?.includes(tile.dataset.hero) : true);if(first)pickHero(first.dataset.hero,true);return;
  }
  if(event.key==='Escape' && !topDialog){event.preventDefault();query='';$('#search').value='';renderContent();$('#search').focus();return;}
  if(typing || event.isComposing)return;
  const search=topDialog==='#picker-dialog' ? $('#hero-search') : !topDialog ? $('#search') : null;
  if(!search)return;
  if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='v'){search.focus();return;}
  if(event.ctrlKey || event.metaKey || event.altKey)return;
  if(event.key.length===1 || event.key==='Backspace' || event.key==='Delete'){
    event.preventDefault();search.focus({preventScroll:true});
    let start=search.selectionStart ?? search.value.length,end=search.selectionEnd ?? start;
    if(event.key==='Backspace' && start===end)start=Math.max(0,start-1);
    if(event.key==='Delete' && start===end)end=Math.min(search.value.length,end+1);
    search.setRangeText(event.key.length===1 ? event.key : '',start,end,'end');
    search.dispatchEvent(new Event('input',{bubbles:true}));
  }
});
$('#detail-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('#editor-dialog').addEventListener('cancel',()=>{editor=null;renderNavigation();});
$('#picker-dialog').addEventListener('cancel',event=>{event.preventDefault();closePicker();});
function readHash(){if(!heroMap)return;const link=parseDraftHash(location.hash);if(link){if(getDraft(link.id))showDetail(link.id,false,link.choices);else toast('This draft could not be found.',true);}else if($('#detail-dialog').open)closeDetail();}
for(const dialog of $$('dialog')){
  let backdropPointer=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',event=>{backdropPointer=event.target===dialog && outside(event);});
  dialog.addEventListener('click',event=>{
    if(backdropPointer && event.target===dialog && outside(event)){
      if(dialog.id==='detail-dialog')closeDetail();
      else if(dialog.id==='picker-dialog')closePicker();
      else {dialog.close();if(dialog.id==='editor-dialog'){editor=null;renderNavigation();}}
    }
    backdropPointer=false;
  });
}
window.addEventListener('popstate',readHash);
window.addEventListener('hashchange',readHash);
window.addEventListener('storage',event=>{if(event.key==='drafts:local'){const values=read('local',[]);if(Array.isArray(values)){localDrafts=values.filter(d=>!validateDraft(d,heroMap).length).map(cleanDraft);renderContent();}}});
await boot();
