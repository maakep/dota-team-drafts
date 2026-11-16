import { cleanDraft } from './domain.js';

export function publishingEndpoint(config) {
  try {const url=new URL(config?.endpoint);return url.protocol==='https:' ? url.href.replace(/\/?$/,'/') : '';} catch {return '';}
}

export async function draftFingerprint(draft) {
  const bytes = new TextEncoder().encode(JSON.stringify(cleanDraft(draft)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...hash].map(n=>n.toString(16).padStart(2,'0')).join('');
}

export async function submitDraft(publishing, draft, previous, {fetcher=fetch, delay=ms=>new Promise(r=>setTimeout(r,ms)), onProgress=()=>{}}={}) {
  const base = publishingEndpoint(publishing);
  if (!base) throw new Error('GitHub saving is not connected.');
  const headers = {'Accept':'application/json'};
  const response = await fetcher(`${base}draft`,{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
    body:JSON.stringify({draft:cleanDraft(draft),previous:previous ? await draftFingerprint(previous) : ''})
  });
  if (!response.ok) throw new Error(`Could not submit the draft (HTTP ${response.status}).`);
  const run = await response.json();
  if (!Number.isSafeInteger(run.id)) throw new Error('The save service did not return a run ID.');
  onProgress('Saving…',run.url);
  for(let attempt=0;attempt<90;attempt++) {
    await delay(2000);
    const status = await fetcher(`${base}runs/${run.id}`,{headers,signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(!status.ok) throw new Error('Could not check the save. Your browser copy is kept; check GitHub Actions.');
    const data = await status.json();
    if(data.status==='completed') {
      if(data.conclusion!=='success') throw new Error('The draft was not saved. It may have changed on GitHub; reload before retrying.');
      return {url:run.url};
    }
  }
  throw new Error('Saving is taking longer than expected. Your browser copy is kept; check GitHub Actions.');
}
