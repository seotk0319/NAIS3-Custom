import {collectPages,endpoints,allowed,readRoute,SessionExpired,readError,traceText,renewable} from './lib/client.mjs';
import {collectEden,collectLuna,collectTeapot} from './lib/special.mjs';
import {normalize} from './lib/model.mjs';
import {profileUpdate,safeSessionSummary,teapotQueries,expiryByOrigin,renewableExpiry,tokenExpiry} from './lib/sessions.mjs';
import {renewSession} from './lib/renewal.mjs';
// A reconnect is the only cure for these; every other failure keeps the 'error' status.
const NEEDS_LOGIN=new Set(['SESSION_QUERIES_MISSING','SESSION_ROUTES_MISSING','SESSION_NOTICE_ROUTES_MISSING']);
const BASE='http://127.0.0.1:43127',VERSION='0.3.12';
const sites={eden:'https://www.eden-chat.com/',babe:'https://babechat.ai/notification?tab=my',luna:'https://lunatalk.chat/member/alarm',elyn:'https://elyn.ai/',neko:'https://www.nekochat.xyz/',teapot:'https://teapotchat.com/notifications',crack:'https://crack.wrtn.ai/',rplay:'https://rplay.live/story',genit:'https://genit.ai/ko'};
let ticking=false,sessionWrites=Promise.resolve();
// Profile writes are serialized so a renewal and a capture never clobber each other.
function serialize(fn){const result=sessionWrites.then(fn);sessionWrites=result.catch(()=>{});return result}
// Profiles live in storage.local so a browser restart does not force a reconnection.
const readSessions=async()=>(await chrome.storage.local.get('apiSessions')).apiSessions||{};
const renewing=new Map(),lastRenewal=new Map();
const settings=()=>chrome.storage.local.get({token:null,enabled:false,lastError:null,apiCheckpoints:{},apiLastRun:{}});
async function local(path,data,token){const r=await fetch(BASE+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Moa-Key':token}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
  if(!r.ok){const reason=await r.json().then(x=>x?.reason).catch(()=>null);throw Error(`LOCAL_HTTP_${r.status}${reason?` · reason=${JSON.stringify(String(reason).slice(0,120))}`:''}`)}
  return r.json()}
function sessionReady(platform,profile){return !!profile&&(platform!=='teapot'||teapotQueries(profile).length>0)&&(platform!=='rplay'||!!profile.routes?.['/account/getuser']);}
async function saveSession(platform,profile){return serialize(async()=>{const apiSessions=await readSessions(),wasReady=sessionReady(platform,apiSessions[platform]);apiSessions[platform]=profileUpdate(platform,profile,apiSessions[platform]);await chrome.storage.local.set({apiSessions});if(!wasReady&&sessionReady(platform,apiSessions[platform])){const {apiLastRun={}}=await chrome.storage.local.get('apiLastRun');delete apiLastRun[platform];await chrome.storage.local.set({apiLastRun})}})}
function babeUserId(token){try{
  const part=String(token||'').replace(/^Bearer\s+/i,'').split('.')[1];
  const claims=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=')));
  return typeof claims.userId==='string'||typeof claims.userId==='number'?String(claims.userId):null;
}catch{return null}}
async function savePassiveBabeRenewal(profile){return serialize(async()=>{
  if(profile?.origin!=='https://api.babechatapi.com'||profile?.renewal?.kind!=='babe')throw Error('UNAPPROVED_SESSION_SENDER');
  const apiSessions=await readSessions(),stored=apiSessions.babe;
  if(!stored)throw Error('UNAPPROVED_SESSION_SENDER');
  const incoming=profile.renewal.refreshToken,current=stored.renewal?.refreshToken;
  const incomingExp=tokenExpiry(incoming),currentExp=tokenExpiry(current);
  if(!incomingExp||Date.parse(incomingExp)<=Date.now())throw Error('UNAPPROVED_RENEWAL_TOKEN');
  const owner=babeUserId(stored.headers?.authorization),incomingOwner=babeUserId(incoming);
  if(!owner||!incomingOwner||owner!==incomingOwner)throw Error('RENEWAL_ACCOUNT_MISMATCH');
  // A site tab with an older cookie must not replace a token the collector rotated.
  if(incoming===current||currentExp&&Date.parse(incomingExp)<=Date.parse(currentExp))return;
  apiSessions.babe=profileUpdate('babe',{origin:profile.origin,renewal:profile.renewal},stored);
  await chrome.storage.local.set({apiSessions});
  const {apiLastRun={}}=await chrome.storage.local.get('apiLastRun');delete apiLastRun.babe;await chrome.storage.local.set({apiLastRun});
})}
// One renewal per account at a time. A failure keeps the old bearer, so the account
// still reports its real error instead of being hidden behind a renewal error.
function renewPlatform(platform,session){
  if(!session.profile?.renewal)return Promise.resolve(false);
  if(!renewing.has(platform)){
    const run=(async()=>{
      const result=await renewSession({platform,profile:session.profile});
      await serialize(async()=>{
        const apiSessions=await readSessions(),stored=apiSessions[platform];if(!stored)return;
        const headersByOrigin={...stored.headersByOrigin};
        for(const origin of result.origins)headersByOrigin[origin]={...headersByOrigin[origin],authorization:result.authorization};
        const primary=platform==='teapot'?'https://firestore.googleapis.com':allowed[platform]?.origin;
        apiSessions[platform]={...stored,headersByOrigin,headers:result.origins.includes(primary)?{...stored.headers,authorization:result.authorization}:stored.headers,renewal:result.renewal,renewedAt:new Date().toISOString()};
        await chrome.storage.local.set({apiSessions});session.profile=apiSessions[platform];
      });
      lastRenewal.delete(platform);return true;
    })();
    renewing.set(platform,run.finally(()=>renewing.delete(platform)));
  }
  return renewing.get(platform);
}
async function transport(platform,session,request,retried=false){
  const {url,method='GET'}=request,profile=session.profile;
  if(platform==='teapot'){
    const query=JSON.parse(request.body||'{}');if(method!=='POST'||!teapotQueries(profile).some(q=>url==='https://firestore.googleapis.com/v1/'+q.parent+':runQuery'&&JSON.stringify(query)===JSON.stringify({structuredQuery:q.structuredQuery})))throw Error('UNAPPROVED_READ_QUERY');
  }else if(method!=='GET')throw Error('READ_ONLY');else readRoute(platform,url);
  const origin=new URL(url).origin,headers=profile?.headersByOrigin?.[origin]||((platform==='teapot'||origin===allowed[platform]?.origin)?profile?.headers:{});
  const response=await fetch(url,{method,headers:{...headers,...request.headers},body:request.body,credentials:'include',redirect:'error',signal:request.signal||AbortSignal.timeout(15000)});
  // An expired bearer is renewed once in place, so the caller never sees the stale failure.
  if(!response.ok&&!retried&&await renewable(response)&&await renewPlatform(platform,session).catch(e=>{lastRenewal.set(platform,e.message);return false}))return transport(platform,session,request,true);
  return response;
}
async function runPlatform(platform){
  const s=await settings(),apiSessions=await readSessions(),session={profile:apiSessions[platform]};
  if(!s.token||!s.enabled)return;
  const status=async(status,detail)=>local('/api/ingest',{transport:'direct-api',platform,channel:'api-status',items:[],status,detail},s.token);
  // Renew before the round rather than after a failure, so one expiry does not cost a whole cycle.
  const due=renewableExpiry(session.profile);
  if(due&&Date.parse(due)-Date.now()<300000)await renewPlatform(platform,session).catch(e=>lastRenewal.set(platform,e.message));
  const request=r=>transport(platform,session,r);
  const commit=async batch=>{
    await local('/api/ingest',{...batch,transport:'direct-api',status:batch.issues?.length||batch.unmapped?'partial':batch.checkpoint?.complete?'ok':'partial',detail:`API 응답 ${batch.received}건 · 미분류 ${batch.unmapped||0}건 · 변환 누락 ${batch.issues?.length||0}건${batch.checkpoint?.next?' · 다음 페이지 이어받기':''}`,items:batch.items},s.token);
    if(batch.checkpoint){const {apiCheckpoints={}}=await chrome.storage.local.get('apiCheckpoints');apiCheckpoints[platform]=batch.checkpoint;await chrome.storage.local.set({apiCheckpoints})}
  };
  try{
    if(platform!=='luna'&&!session.profile){await status('login','API 세션 연결이 필요해요.');return}
    if(platform==='eden')await collectEden({profile:session.profile,transport:request,commit,checkpoint:s.apiCheckpoints[platform]?.complete?null:s.apiCheckpoints[platform]});
    else if(platform==='luna')await collectLuna({transport:request,commit,checkpoint:s.apiCheckpoints[platform]?.complete?null:s.apiCheckpoints[platform]});
    else if(platform==='teapot')await collectTeapot({profile:session.profile,transport:request,commit});
    else{
      const route=platform==='rplay'?session.profile.routes['/account/getuser']:session.profile.routes[new URL(endpoints[platform]).pathname]||endpoints[platform];
      if(!route)throw Error('SESSION_ROUTES_MISSING');
      const cursor=s.apiCheckpoints[platform]?.complete?null:s.apiCheckpoints[platform];
      // Refresh the newest page even while a historical continuation is pending.
      if(cursor?.next)await collectPages({platform,transport:request,commit:batch=>local('/api/ingest',{...batch,transport:'direct-api',channel:'latest',status:'partial',detail:'최신 알림 API 조회',items:batch.items},s.token),startUrl:route,maxPages:1,stage:'latest'});
      await collectPages({platform,transport:request,commit,startUrl:route,checkpoint:cursor,maxPages:40,stage:platform==='rplay'?'getuser':'list'});
      if(platform==='rplay'&&session.profile.routes['/account/popup-notifications/active']){
        const response=await request({platform,url:session.profile.routes['/account/popup-notifications/active'],method:'GET'});if(!response.ok)throw await readError(platform,response,session.profile.routes['/account/popup-notifications/active'],'popup');
        const batch=normalize(platform,await response.json(),{channel:'global',classification:{event:'admin',type:'popup',evidence:'source-route'}});await commit({...batch,platform,channel:'global'});
      }
    }
  }catch(e){
    // The stored token's own expiry travels with the failure, so an expired
    // credential is never mistaken for a broken route or a server outage.
    const tokens=expiryByOrigin(session.profile),oldest=Object.values(tokens).sort()[0]||null,renewal=lastRenewal.get(platform);
    const suffix=[oldest&&traceText({tokenExp:oldest,now:new Date().toISOString()}),renewal&&`renewal=${JSON.stringify(String(renewal).slice(0,200))}`].filter(Boolean).map(x=>` · ${x}`).join('');
    await status(e instanceof SessionExpired||NEEDS_LOGIN.has(e.message)?'login':'error',`${e.message}${suffix}`);
  }
  finally{
    // A disconnected account must yield its slot to the other platforms too.
    lastRenewal.delete(platform);
    const {apiLastRun={}}=await chrome.storage.local.get('apiLastRun');apiLastRun[platform]=Date.now();await chrome.storage.local.set({apiLastRun});
  }
}
async function advanceConnections(){
  const {connectionTabs={},connectionQueue=[]}=await chrome.storage.session.get(['connectionTabs','connectionQueue']);
  for(const [id,job] of Object.entries(connectionTabs))if(Date.now()-job.started>60000){try{const tab=await chrome.tabs.get(+id);if(new URL(tab.url).hostname===new URL(sites[job.platform]).hostname)await chrome.tabs.remove(+id)}catch{}delete connectionTabs[id]}
  // This queue is filled only by the user's explicit "connect" action, never by polling.
  while(connectionQueue.length&&Object.keys(connectionTabs).length<2){const platform=connectionQueue.shift(),tab=await chrome.tabs.create({url:'about:blank',active:false});connectionTabs[tab.id]={platform,started:Date.now()};await chrome.storage.session.set({connectionTabs,connectionQueue});await chrome.tabs.update(tab.id,{url:sites[platform]})}
  await chrome.storage.session.set({connectionTabs,connectionQueue});
}
async function tick(){if(ticking)return;ticking=true;try{
  await advanceConnections();const s=await settings();if(!s.token)return;
  const {connectionTabs={},connectionQueue=[]}=await chrome.storage.session.get(['connectionTabs','connectionQueue']),apiSessions=await readSessions();
  const sessions=Object.fromEntries(Object.entries(apiSessions).map(([p,profile])=>[p,safeSessionSummary(profile)]));
  const heartbeat=await local('/api/heartbeat',{version:VERSION,running:s.enabled,mode:'direct-api',sessions},s.token);await chrome.storage.local.set({enabled:heartbeat.enabled});if(!heartbeat.enabled)return;
  const connecting=new Set([...connectionQueue,...Object.values(connectionTabs).map(x=>x.platform)]);
  const due=Object.keys(sites).filter(p=>!connecting.has(p)&&Date.now()-(s.apiLastRun[p]||0)>=300000).slice(0,2);
  for(const p of due)await runPlatform(p);
  await chrome.storage.local.set({lastError:null});
}catch(e){await chrome.storage.local.set({lastError:e.message})}finally{ticking=false}}
async function alarm(){if(!await chrome.alarms.get('moa-tick'))await chrome.alarms.create('moa-tick',{periodInMinutes:0.5})}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  (async()=>{
    if(sender.tab){const {connectionTabs={}}=await chrome.storage.session.get('connectionTabs'),job=connectionTabs[sender.tab.id];
      // A connected Babe tab can recapture its own rotated cookie after a page load.
      // This never opens a tab, and other platforms still require explicit connection.
      const babeTab=new URL(sender.url).hostname==='babechat.ai';
      const passiveBabe=babeTab&&!!(await readSessions()).babe;
      if(message.type==='session-ready')return {enabled:!!job||passiveBabe,renewalOnly:!job&&passiveBabe};
      if(message.type==='session-profile'){
        if(job){if(job.platform!==message.platform||new URL(sender.url).hostname!==new URL(sites[job.platform]).hostname)throw Error('UNAPPROVED_SESSION_SENDER')}
        else{if(!(passiveBabe&&message.platform==='babe'))throw Error('UNAPPROVED_SESSION_SENDER');await savePassiveBabeRenewal(message.profile);return {ok:true}}
        await saveSession(message.platform,message.profile);return {ok:true}
      }
      throw Error('UNAPPROVED_ACTION');
    }
    if(sender.url!==chrome.runtime.getURL('popup.html'))throw Error('UNAPPROVED_CALLER');
    if(message.type==='status'){const s=await settings(),{connectionQueue=[],connectionTabs={}}=await chrome.storage.session.get(['connectionQueue','connectionTabs']),apiSessions=await readSessions();return {paired:!!s.token,enabled:s.enabled,queued:0,lastError:s.lastError,version:VERSION,connecting:connectionQueue.length+Object.keys(connectionTabs).length,sessions:Object.fromEntries(Object.keys(sites).map(p=>[p,safeSessionSummary(apiSessions[p])]))}}
    if(message.type==='connect'){await chrome.storage.session.set({connectionQueue:Object.keys(sites).filter(p=>p!=='luna')});await advanceConnections();return {ok:true}}
    if(message.type==='sync'){await chrome.storage.local.set({apiLastRun:{}});await tick();return {ok:true}}
    if(message.type==='pair'){const auth=await local('/api/pair',{code:String(message.code||'').trim()});await chrome.storage.local.set({token:auth.token});await alarm();return {ok:true}}
    throw Error('UNAPPROVED_ACTION');
  })().then(reply,e=>reply({error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='moa-tick')return tick()});
chrome.runtime.onInstalled.addListener(alarm);chrome.runtime.onStartup.addListener(alarm);alarm().catch(()=>{});
