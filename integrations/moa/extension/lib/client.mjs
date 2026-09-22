import {normalize,list} from './model.mjs';
export const endpoints={
  eden:'https://www.eden-chat.com/api/notifications?limit=60&offset=0',
  elyn:'https://api.seoul.elyn.ai/api/v1/notifications/mine?page=1&page_size=20',
  neko:'https://www.nekochat.xyz/api/notifications?limit=5',
  crack:'https://crack-api.wrtn.ai/crack-api/alarm?page=1&limit=20',
  genit:'https://api.genit.ai/api/notifications/?lang=ko',
  babe:'https://api.babechatapi.com/ko/api/notifications',
};
export const allowed={
  eden:{origin:'https://jhbfalszdxacwjnrrvms.supabase.co',paths:['/rest/v1/notifications','/rest/v1/notification_deliveries','/rest/v1/global_notifications','/rest/v1/notification_content','/rest/v1/user_read_tracking'],alternates:[{origin:'https://www.eden-chat.com',paths:['/api/notifications']}]},
  babe:{origin:'https://api.babechatapi.com',paths:['/ko/api/notifications']},
  elyn:{origin:'https://api.seoul.elyn.ai',paths:['/api/v1/notifications/mine']},
  neko:{origin:'https://www.nekochat.xyz',paths:['/api/notifications']},
  crack:{origin:'https://crack-api.wrtn.ai',paths:['/crack-api/alarm']},
  genit:{origin:'https://api.genit.ai',paths:['/api/notifications/']},
  rplay:{origin:'https://api.rplay.live',paths:['/account/getuser','/account/popup-notifications/active']},
  luna:{origin:'https://lunatalk.chat',paths:['/member/alarm']},
};
export function readRoute(platform,value){const u=new URL(value),rule=allowed[platform];if(!rule||![rule,...rule.alternates||[]].some(r=>u.origin===r.origin&&r.paths.includes(u.pathname))||u.username||u.password||u.hash)throw Error('UNAPPROVED_READ_ROUTE');return u.href}
// Failure context a person can act on, carrying no credential material: host and
// pathname only. A query string may identify the account, so it never appears.
export function requestTrace(url,extra={}){let where=null;try{const u=new URL(url);where=`${u.host}${u.pathname}`}catch{/* A trace must never mask the original failure. */}
  return Object.fromEntries(Object.entries({...extra,where}).filter(([,value])=>value!==null&&value!==undefined&&value!==''));}
export const traceText=trace=>Object.entries(trace).map(([key,value])=>`${key}=${value}`).join(' ');
// Only a short, explicitly named server code from a failed response; never its body.
export async function failureHint(response){
  try{
    const type=(response.headers.get('content-type')||'').split(';')[0].trim();
    if(!/json/i.test(type))return {type:type||'unknown'};
    const data=JSON.parse((await response.clone().text()).slice(0,2000));
    const code=[data.code,data.error_code,data.error,data.message,data.msg,data.detail].find(x=>typeof x==='string'&&x);
    return code?{code:JSON.stringify(code.slice(0,120))}:{type:'json'};
  }catch{return {}}
}
export class SessionExpired extends Error{constructor(platform,trace={}){super(`${platform}: SESSION_EXPIRED${Object.keys(trace).length?` · ${traceText(trace)}`:''}`);this.platform=platform;this.name='SessionExpired';this.trace=trace}}
// Some servers answer an expired bearer with 5xx instead of 401. Observed codes are
// listed one by one: a renewal may be worth trying, but the failure is still reported
// as a server error, never as a logged-out account.
export const authInvalidCodes=new Set(['AUTH_TOKEN_INVALID']);
export async function renewable(response,hint){
  if(response.status===401||response.status===403)return true;
  if(response.status<500)return false;
  const code=(hint||await failureHint(response)).code;
  return typeof code==='string'&&authInvalidCodes.has(code.replace(/^"|"$/g,''));
}
// One place separates 401/403 from every other status, so no caller can blur them.
export async function readError(platform,response,url,stage){
  const trace=requestTrace(url,{stage,status:response.status,...await failureHint(response)});
  if(response.status===401||response.status===403)return new SessionExpired(platform,trace);
  const error=Error(`${platform}: HTTP_${response.status} · ${traceText(trace)}`);
  error.platform=platform;error.trace=trace;return error;
}
export function nextPage(platform,body,current){
  const u=new URL(current),rows=list(body)||[];
  if(platform==='eden'&&u.pathname==='/api/notifications'&&rows.length===Number(u.searchParams.get('limit')||60)){u.searchParams.set('offset',String(Number(u.searchParams.get('offset')||0)+rows.length));return u.href}
  if(platform==='elyn'){const total=body.total_count??body.data?.total_count,page=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('page_size')||20);if(typeof total==='number'&&rows.length&&page*size<total){u.searchParams.set('page',String(page+1));return u.href}}
  if(platform==='neko'&&body.pagination?.hasMore===true&&body.pagination.nextCursor){u.searchParams.set('before',body.pagination.nextCursor);return u.href}
  if(platform==='crack'&&body.data?.hasNext===true){u.searchParams.set('page',String(Number(u.searchParams.get('page')||1)+1));return u.href}
  if(platform==='genit'&&body.next){const next=readRoute(platform,new URL(body.next,current).href);if(new URL(next).pathname!==u.pathname)throw Error('INVALID_NEXT_PAGE');return next}
  return null;
}
// The host supplies authenticated transport and persistence; no Chrome or NAIS dependency.
// transport returns a standard Response and never exposes credentials to normalization.
export async function collectPages({platform,transport,commit,startUrl=endpoints[platform],checkpoint=null,maxPages=40,signal,stage='list'}){
  if(typeof transport!=='function'||typeof commit!=='function')throw Error('Transport and commit are required');
  let url=readRoute(platform,checkpoint?.next||startUrl),pages=0,received=0,accepted=0,unmapped=0;const visited=new Set();
  while(url&&pages<maxPages){
    signal?.throwIfAborted();if(visited.has(url))throw Error('PAGINATION_CYCLE');visited.add(url);
    const response=await transport({platform,url,method:'GET',signal});
    if(!response.ok)throw await readError(platform,response,url,`${stage}:p${pages+1}`);
    const body=await response.json(),result=normalize(platform,platform==='rplay'?{notifications:body.notifications}:body),next=nextPage(platform,body,url);
    if(next)readRoute(platform,next);
    const progress={next,complete:!next,pages:(checkpoint?.pages||0)+pages+1,scope:platform==='babe'?'returned-window':'list'};
    // Advance only after the consumer has durably committed this batch.
    await commit({platform,channel:'personal',...result,checkpoint:progress});
    pages++;received+=result.received;accepted+=result.items.length;unmapped+=result.unmapped;url=next;
  }
  return {platform,pages,received,accepted,unmapped,checkpoint:{next:url,complete:!url,pages:(checkpoint?.pages||0)+pages}};
}
