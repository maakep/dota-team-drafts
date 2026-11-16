import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishingEndpoint,draftFingerprint,submitDraft} from '../src/publishing.js';
import {saveDraft} from '../scripts/save-draft.mjs';

const draft=()=>({id:'workflow-test',title:'Test draft',pos1:['luna'],pos5:['lich'],pos2:['puck'],pos4:['rubick'],pos3:['axe']});
const tmpParent=await realpath(os.tmpdir());
const root=await realpath(await mkdtemp(path.join(tmpParent,'dota-drafts-')));
await mkdir(path.join(root,'data/drafts'),{recursive:true});
await writeFile(path.join(root,'data/heroes.json'),await readFile(new URL('../data/heroes.json',import.meta.url)));
test.after(async()=>{
  const target=await realpath(root);
  if(path.dirname(target)!==tmpParent || !path.basename(target).startsWith('dota-drafts-'))throw Error('Unexpected test cleanup path');
  await rm(target,{recursive:true,force:true});
});

test('publishing config accepts only an HTTPS service address',()=>{
  assert.equal(publishingEndpoint({endpoint:'https://relay.example/api'}),'https://relay.example/api/');
  assert.equal(publishingEndpoint({endpoint:'http://relay.example'}),'');assert.equal(publishingEndpoint({}),'');
});
test('workflow writes only a validated draft and rejects stale updates',async()=>{
  const first=draft();await writeFile(path.join(root,'sentinel.txt'),'unchanged');
  assert.deepEqual(await saveDraft(JSON.stringify({...first,ignored:'discard me'}),'',root),{id:first.id,changed:true});
  const target=path.join(root,'data/drafts',`${first.id}.json`);
  assert.equal(JSON.parse(await readFile(target,'utf8')).ignored,undefined);
  await assert.rejects(saveDraft(JSON.stringify({...first,title:'Changed'}),'',root),/changed on GitHub/);
  const previous=await draftFingerprint(first);
  assert.equal((await saveDraft(JSON.stringify(first),previous,root)).changed,false);
  assert.equal((await saveDraft(JSON.stringify({...first,title:'Changed'}),previous,root)).changed,true);
  await assert.rejects(saveDraft(JSON.stringify({...first,title:'Stale'}),previous,root),/changed on GitHub/);
  assert.equal(JSON.parse(await readFile(target,'utf8')).title,'Changed');
  for(const value of [{...first,id:'../../sentinel'}, {...first,id:'other',pos1:['unknown']}])await assert.rejects(saveDraft(JSON.stringify(value),'',root));
  await assert.rejects(saveDraft('x'.repeat(24577),'',root),/24 KB/);
  await assert.rejects(saveDraft('{bad','',root),/Invalid draft/);
  assert.deepEqual(await readdir(path.join(root,'data/drafts')),['workflow-test.json']);
  assert.equal(await readFile(path.join(root,'sentinel.txt'),'utf8'),'unchanged');
});
test('browser dispatch sends JSON inputs and waits for confirmed success',async()=>{
  const calls=[];let progress=false;
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify(options.method==='POST'?{id:123,url:'https://github.com/example/repo/actions/runs/123'}:{status:'completed',conclusion:'success'}));
  };
  await submitDraft({endpoint:'https://relay.example'},draft(),null,{fetcher,delay:async()=>{},onProgress:()=>{progress=true;}});
  const payload=JSON.parse(calls[0].options.body);
  assert.equal(payload.previous,'');assert.deepEqual(payload.draft,draft());assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.match(calls[0].url,/\/draft$/);assert.match(calls[1].url,/\/runs\/123$/);assert.equal(progress,true);
});
test('failed dispatch or run never reports a successful save',async()=>{
  const pub={endpoint:'https://relay.example'};
  await assert.rejects(submitDraft(pub,draft(),null,{fetcher:async()=>new Response('',{status:403})}),/submit/);
  await assert.rejects(submitDraft(pub,draft(),null,{fetcher:async()=>Response.json({error:'Too many requests. Try again in a minute.'},{status:429})}),/Too many requests/);
  await assert.rejects(submitDraft(pub,draft(),null,{fetcher:async(url,options)=>new Response(JSON.stringify(options.method==='POST'?{id:1}:{status:'completed',conclusion:'failure'})),delay:async()=>{}}),/not saved/);
});
