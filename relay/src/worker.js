import heroes from '../../data/heroes.json' with {type:'json'};
import {validateDraft,cleanDraft} from '../../src/domain.js';

const heroIds=new Set(heroes.map(hero=>hero.id));
const MAX_BODY=32768;
const WORKFLOW='.github/workflows/save-draft.yml';
class RequestError extends Error {
  constructor(status,message){super(message);this.status=status;}
}

async function readBody(request){
  if(Number(request.headers.get('Content-Length'))>MAX_BODY)throw new RequestError(413,'Draft request is too large.');
  const reader=request.body?.getReader();
  if(!reader)throw new RequestError(400,'A draft is required.');
  const chunks=[];let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>MAX_BODY){await reader.cancel();throw new RequestError(413,'Draft request is too large.');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new RequestError(400,'Invalid JSON.');}
}

async function rateLimit(binding,key){
  if(!binding?.limit)throw new RequestError(503,'The save service is not configured yet.');
  if(!(await binding.limit({key})).success)throw new RequestError(429,'Too many requests. Try again in a minute.');
}

export async function handleRequest(request,env,{fetcher=fetch}={}){
  const origin=request.headers.get('Origin');
  const allowed=env.ALLOWED_ORIGIN || 'https://maakep.github.io';
  const cors={
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Vary':'Origin',
    ...(origin===allowed ? {'Access-Control-Allow-Origin':allowed} : {})
  };
  const reply=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...cors,...extra}});
  try{
    const pathname=new URL(request.url).pathname.replace(/\/$/,'') || '/';
    if(request.method==='GET' && (pathname==='/' || pathname==='/health')){
      return reply({ok:true,configured:Boolean(env.GITHUB_ACTIONS_TOKEN && env.SAVE_LIMITER?.limit && env.STATUS_LIMITER?.limit)});
    }
    if(origin!==allowed)throw new RequestError(403,'This origin is not allowed.');
    if(request.method==='OPTIONS'){
      if(pathname!=='/draft' && !/^\/runs\/[1-9]\d{0,15}$/.test(pathname))throw new RequestError(404,'Not found.');
      return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
    }
    const repository=env.GITHUB_REPOSITORY;
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !env.GITHUB_ACTIONS_TOKEN)throw new RequestError(503,'The save service is not configured yet.');
    const headers={
      'Accept':'application/vnd.github+json',
      'Authorization':`Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
      'X-GitHub-Api-Version':'2026-03-10',
      'User-Agent':'dota-team-drafts-relay'
    };
    const github=async(path,options={})=>{
      const response=await fetcher(`https://api.github.com/repos/${repository}${path}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok)throw new RequestError(502,'GitHub could not process the request. Check the relay token and try again.');
      try{return await response.json();}catch{throw new RequestError(502,'GitHub returned an unexpected response.');}
    };
    const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
    if(request.method==='POST' && pathname==='/draft'){
      await rateLimit(env.SAVE_LIMITER,`save:${ip}`);
      if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new RequestError(415,'Send the draft as JSON.');
      const body=await readBody(request);
      if(!body || typeof body!=='object' || Array.isArray(body))throw new RequestError(400,'A draft is required.');
      const errors=validateDraft(body.draft,heroIds);
      if(errors.length)throw new RequestError(400,errors.join(' '));
      const previous=body.previous ?? '';
      if(typeof previous!=='string' || previous!=='' && !/^[a-f0-9]{64}$/.test(previous))throw new RequestError(400,'Invalid previous draft fingerprint.');
      const json=JSON.stringify(cleanDraft(body.draft));
      if(new TextEncoder().encode(json).byteLength>24576)throw new RequestError(413,'Draft JSON must be under 24 KB.');
      const run=await github('/actions/workflows/save-draft.yml/dispatches',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ref:'main',inputs:{draft:json,previous}})
      });
      if(!Number.isSafeInteger(run.workflow_run_id) || run.workflow_run_id<=0)throw new RequestError(502,'GitHub did not return a save run ID.');
      return reply({id:run.workflow_run_id,url:`https://github.com/${repository}/actions/runs/${run.workflow_run_id}`},202);
    }
    const runMatch=pathname.match(/^\/runs\/([1-9]\d{0,15})$/);
    if(request.method==='GET' && runMatch){
      await rateLimit(env.STATUS_LIMITER,`status:${ip}`);
      const run=await github(`/actions/runs/${runMatch[1]}`);
      if(run.path?.split('@')[0]!==WORKFLOW || run.head_branch!=='main' || run.event!=='workflow_dispatch')throw new RequestError(404,'Save run not found.');
      return reply({status:run.status,conclusion:run.conclusion || null});
    }
    throw new RequestError(404,'Not found.');
  }catch(error){
    if(error instanceof RequestError)return reply({error:error.message},error.status,error.status===429 ? {'Retry-After':'60'} : {});
    return reply({error:'The save service is temporarily unavailable.'},503);
  }
}

export default {fetch:handleRequest};
