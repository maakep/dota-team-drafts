import { cleanDraft } from './domain.js';

export function publishingToken(config) {
  if (!Array.isArray(config?.parts) || !Array.isArray(config?.key) || !config.key.length) return '';
  try {
    const bytes = Uint8Array.from(atob([...config.parts].reverse().join('')), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes.map((n,i) => n ^ config.key[i % config.key.length]));
  } catch { return ''; }
}

export async function draftFingerprint(draft) {
  const bytes = new TextEncoder().encode(JSON.stringify(cleanDraft(draft)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...hash].map(n=>n.toString(16).padStart(2,'0')).join('');
}

export async function submitDraft(config, publishing, draft, previous, {fetcher=fetch, delay=ms=>new Promise(r=>setTimeout(r,ms)), onProgress=()=>{}}={}) {
  const token = publishingToken(publishing);
  if (!token) throw new Error('GitHub saving is not connected.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) throw new Error('Invalid repository.');
  const base = `https://api.github.com/repos/${config.repository}`;
  const headers = {'Accept':'application/vnd.github+json','Authorization':`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10'};
  const response = await fetcher(`${base}/actions/workflows/save-draft.yml/dispatches`,{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
    body:JSON.stringify({ref:config.branch || 'main',inputs:{draft:JSON.stringify(cleanDraft(draft)),previous:previous ? await draftFingerprint(previous) : ''}})
  });
  if (!response.ok) throw new Error(response.status===401 || response.status===403 ? 'GitHub saving is unavailable. The dispatch token may have expired.' : `Could not submit the draft (HTTP ${response.status}).`);
  const run = await response.json();
  if (!Number.isSafeInteger(run.workflow_run_id)) throw new Error('GitHub accepted the request without a run ID. Check the repository Actions page.');
  onProgress('Saving…',run.html_url);
  for(let attempt=0;attempt<90;attempt++) {
    await delay(2000);
    const status = await fetcher(`${base}/actions/runs/${run.workflow_run_id}`,{headers,signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(!status.ok) throw new Error('Could not check the save. Your browser copy is kept; check GitHub Actions.');
    const data = await status.json();
    if(data.status==='completed') {
      if(data.conclusion!=='success') throw new Error('The draft was not saved. It may have changed on GitHub; reload before retrying.');
      return {url:run.html_url};
    }
  }
  throw new Error('Saving is taking longer than expected. Your browser copy is kept; check GitHub Actions.');
}
