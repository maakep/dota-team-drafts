import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../relay/src/worker.js';

const origin='https://maakep.github.io';
const credential='test-only-server-credential';
const draft=()=>({id:'relay-test',title:'Relay test',pos1:['luna'],pos5:['lich'],pos2:['puck'],pos4:['rubick'],pos3:['axe']});
const environment=()=>({
  ALLOWED_ORIGIN:origin,GITHUB_REPOSITORY:'maakep/dota-team-drafts',GITHUB_ACTIONS_TOKEN:credential,
  SAVE_LIMITER:{limit:async()=>({success:true})},STATUS_LIMITER:{limit:async()=>({success:true})}
});
function request(path='/draft',body={draft:draft()},headers={}){
  return new Request(`https://relay.example${path}`,{
    method:body===null?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...headers},
    ...(body===null?{}:{body:JSON.stringify(body)})
  });
}
const noFetch=()=>{throw Error('Unexpected GitHub request');};

test('relay health reveals no credential and reports incomplete setup',async()=>{
  const env=environment();delete env.GITHUB_ACTIONS_TOKEN;
  const response=await handleRequest(new Request('https://relay.example/health'),env,{fetcher:noFetch});
  assert.deepEqual(await response.json(),{ok:true,configured:false});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('relay permits the Pages preflight and rejects other origins',async()=>{
  const options=new Request('https://relay.example/draft',{method:'OPTIONS',headers:{Origin:origin}});
  const response=await handleRequest(options,environment(),{fetcher:noFetch});
  assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  for(const invalid of ['https://example.com','null','']){
    const denied=await handleRequest(request('/draft',{draft:draft()},{Origin:invalid}),environment(),{fetcher:noFetch});
    assert.equal(denied.status,403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
  }
});

test('invalid drafts and fingerprints never dispatch a workflow',async()=>{
  for(const body of [null,[],{}, {draft:{...draft(),id:'../../other'}},{draft:{...draft(),pos1:['unknown-hero']}},{draft:draft(),previous:'stale'}]){
    const response=await handleRequest(request('/draft',body===null?'null':body),environment(),{fetcher:noFetch});
    assert.equal(response.status,400);
  }
  const invalidJSON=new Request('https://relay.example/draft',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{bad'});
  assert.equal((await handleRequest(invalidJSON,environment(),{fetcher:noFetch})).status,400);
  assert.equal((await handleRequest(request('/draft',{draft:draft()},{'Content-Type':'text/plain'}),environment(),{fetcher:noFetch})).status,415);
});

test('relay bounds streamed input even without a content length',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(32769)));controller.close();}});
  const oversized=new Request('https://relay.example/draft',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body,duplex:'half'});
  assert.equal((await handleRequest(oversized,environment(),{fetcher:noFetch})).status,413);
});

test('relay dispatches only the fixed workflow and keeps the token server-side',async()=>{
  const calls=[];const env=environment();
  env.SAVE_LIMITER.limit=async options=>{assert.deepEqual(options,{key:'save:192.0.2.1'});return {success:true};};
  const response=await handleRequest(request('/draft',{
    draft:{...draft(),ignored:'discard this'},previous:'a'.repeat(64),repository:'attacker/repo',ref:'other',workflow:'other.yml'
  }),env,{fetcher:async(url,options)=>{
    calls.push({url,options});return Response.json({workflow_run_id:123});
  }});
  assert.equal(response.status,202);
  assert.deepEqual(await response.json(),{id:123,url:'https://github.com/maakep/dota-team-drafts/actions/runs/123'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.github.com/repos/maakep/dota-team-drafts/actions/workflows/save-draft.yml/dispatches');
  assert.equal(calls[0].options.headers.Authorization,`Bearer ${credential}`);
  assert.equal(calls[0].options.redirect,'manual');
  const payload=JSON.parse(calls[0].options.body);
  assert.deepEqual(payload,{ref:'main',inputs:{draft:JSON.stringify(draft()),previous:'a'.repeat(64)}});
});

test('relay rate limits submissions and fails closed without bindings',async()=>{
  const env=environment();env.SAVE_LIMITER.limit=async()=>({success:false});
  const limited=await handleRequest(request(),env,{fetcher:noFetch});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  delete env.SAVE_LIMITER;
  assert.equal((await handleRequest(request(),env,{fetcher:noFetch})).status,503);
  delete env.GITHUB_ACTIONS_TOKEN;
  assert.equal((await handleRequest(request(),env,{fetcher:noFetch})).status,503);
});

test('relay status exposes only save workflow results on main',async()=>{
  const run={path:'.github/workflows/save-draft.yml',head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success',secret:credential};
  const response=await handleRequest(request('/runs/123',null),environment(),{fetcher:async(url)=>{
    assert.equal(url,'https://api.github.com/repos/maakep/dota-team-drafts/actions/runs/123');return Response.json(run);
  }});
  assert.deepEqual(await response.json(),{status:'completed',conclusion:'success'});
  for(const invalid of [{path:'.github/workflows/pages.yml'},{head_branch:'other'},{event:'push'}]){
    const denied=await handleRequest(request('/runs/123',null),environment(),{fetcher:async()=>Response.json({...run,...invalid})});
    assert.equal(denied.status,404);
  }
  const env=environment();env.STATUS_LIMITER.limit=async()=>({success:false});
  assert.equal((await handleRequest(request('/runs/123',null),env,{fetcher:noFetch})).status,429);
  assert.equal((await handleRequest(request('/runs/123/other',null),environment(),{fetcher:noFetch})).status,404);
});

test('relay masks upstream errors and rejects missing dispatch run IDs',async()=>{
  for(const fetcher of [async()=>new Response(credential,{status:403}),async()=>Response.json({}),async()=>{throw Error(credential);}]){
    const response=await handleRequest(request(),environment(),{fetcher});
    assert.ok(response.status>=500);
    assert.equal((await response.text()).includes(credential),false);
  }
});

test('relay does not follow upstream redirects with its credential',async()=>{
  let calls=0;
  const response=await handleRequest(request(),environment(),{fetcher:async(url,options)=>{
    calls++;
    assert.equal(new URL(url).origin,'https://api.github.com');
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://example.com/collect'}});
  }});
  assert.equal(response.status,502);
  assert.equal(calls,1);
  assert.equal((await response.text()).includes(credential),false);
});
