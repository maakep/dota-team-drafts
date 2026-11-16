import test from 'node:test';
import assert from 'node:assert/strict';
import { api, loadTeamMatches, loadSingleMatch } from '../src/opendota.js';
const config={teamId:42,teamName:'Our team',manualMatches:[]};
const json=value=>new Response(JSON.stringify(value),{status:200});
const delay=async()=>{};
const detail={match_id:123,radiant_team_id:42,dire_team_id:51,radiant_win:true,players:Array.from({length:5},(_,i)=>({hero_id:i+1,player_slot:i}))};
test('keyless client handles rate limits and empty team responses clearly',async()=>{
  await assert.rejects(api('/teams/42',async()=>new Response('',{status:429})),/rate limit/);
  await assert.rejects(api('/teams/42',async()=>new Response('',{status:200})),/no team metadata/);
});
test('missing team metadata does not prevent reading match heroes',async()=>{
  const fetcher=async url=>url.endsWith('/teams/42')?new Response(''):url.endsWith('/teams/42/matches')?json([{match_id:123,radiant:true}]):json(detail);
  const result=await loadTeamMatches(config,{fetcher,delay});assert.equal(result.teamName,'Our team');assert.equal(result.matches[0].complete,true);assert.deepEqual(result.warnings,[]);
});
test('cached complete lineups avoid repeated match-detail requests',async()=>{
  const requested=[];const fetcher=async url=>{requested.push(url);return url.endsWith('/matches')?json([{match_id:123,radiant:true}]):json({name:'Team'});};
  const previous={teamId:42,matches:[{id:123,heroes:[1,2,3,4,5],complete:true}]};
  const result=await loadTeamMatches(config,{fetcher,delay,previous});assert.equal(result.matches.length,1);assert.ok(!requested.some(url=>url.endsWith('/matches/123')));
});
test('partial failures keep both old matches and list metadata',async()=>{
  const fetcher=async url=>url.endsWith('/teams/42')?json({}):url.endsWith('/teams/42/matches')?json([{match_id:123,radiant:false,opposing_team_name:'Opponent'}]):new Response('',{status:503});
  const result=await loadTeamMatches(config,{fetcher,delay,previous:{teamId:42,matches:[{id:100,heroes:[1,2,3,4,5],complete:true}]}});
  assert.equal(result.matches.length,2);assert.equal(result.matches[0].opponent,'Opponent');assert.equal(result.matches[0].complete,false);assert.equal(result.warnings.length,1);
});
test('unavailable API throws instead of replacing cached data with an empty success',async()=>{
  await assert.rejects(loadTeamMatches(config,{fetcher:async()=>new Response('',{status:503}),delay}),/503/);
});
test('manual matches work even when the team listing is empty',async()=>{
  const fetcher=async url=>url.endsWith('/teams/42')?json({}):url.endsWith('/teams/42/matches')?json([]):json({...detail,radiant_team_id:null,dire_team_id:null});
  const result=await loadTeamMatches({...config,manualMatches:[{id:123,side:'radiant'}]},{fetcher,delay});assert.equal(result.matches.length,1);assert.equal(result.matches[0].complete,true);
});
test('manual match loader validates IDs and requires side detection',async()=>{
  await assert.rejects(loadSingleMatch('../bad',42,'',async()=>json(detail)),/numeric match ID/);
  await assert.rejects(loadSingleMatch(123,42,'',async()=>json({...detail,radiant_team_id:null,dire_team_id:null})),/side is missing/);
  assert.equal((await loadSingleMatch(123,42,'radiant',async()=>json(detail))).complete,true);
});
test('amateur history fallback verifies team IDs and excludes unrelated player games',async()=>{
  const anchor={...detail,players:detail.players.map(p=>({...p,account_id:500}))};
  const requested=[];
  const fetcher=async url=>{
    requested.push(url);
    if(url.endsWith('/teams/42'))return json({});
    if(url.endsWith('/teams/42/matches'))return json([]);
    if(url.endsWith('/matches/123'))return json(anchor);
    if(url.includes('/players/500/matches'))return json([{match_id:303},{match_id:202},{match_id:123}]);
    if(url.endsWith('/matches/303'))return json({...detail,match_id:303,radiant_team_id:77,dire_team_id:88});
    if(url.endsWith('/matches/202'))return json({...detail,match_id:202});
    throw Error(`Unexpected request ${url}`);
  };
  const result=await loadTeamMatches({...config,historyMatchId:123},{fetcher,delay});
  assert.deepEqual(result.matches.map(m=>m.id),[202,123]);assert.ok(result.matches.every(m=>m.complete));
  assert.equal(requested.filter(url=>url.endsWith('/matches/123')).length,1);
});
test('history fetches and displays at most twenty matches',async()=>{
  let details=0;
  const fetcher=async url=>{
    if(url.endsWith('/teams/42'))return json({});
    if(url.endsWith('/teams/42/matches'))return json(Array.from({length:25},(_,i)=>({match_id:200-i,radiant:true})));
    details++;return json({...detail,match_id:Number(url.split('/').at(-1))});
  };
  const result=await loadTeamMatches(config,{fetcher,delay});assert.equal(result.matches.length,20);assert.equal(details,20);
});
