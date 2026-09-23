import {allowed,readRoute} from './client.mjs';
import {renewalRecord,renewalKinds} from './renewal.mjs';
const apiOrigins=new Set([...Object.values(allowed).flatMap(r=>[r.origin,...(r.alternates||[]).map(a=>a.origin)]),'https://firestore.googleapis.com']);
export const headerNames=['authorization','apikey','x-api-key','platform-type','refresh-token'];
// The API still validates the token. Decoding here only selects its own user's
// observed notice collection; never accept an arbitrary UID or collection.
export function teapotQueries(profile){
  const auth=profile?.headersByOrigin?.['https://firestore.googleapis.com']?.authorization||profile?.headers?.authorization;
  if(typeof auth==='string'&&auth.startsWith('Bearer ')){
    try{
      const part=auth.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),claims=JSON.parse(atob(part));
      if(claims.iss==='https://securetoken.google.com/chat-ai-7a275'&&claims.aud==='chat-ai-7a275'&&typeof claims.sub==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)){
        const root='projects/chat-ai-7a275/databases/(default)/documents';
        return [{parent:`${root}/users/${claims.sub}`,structuredQuery:{from:[{collectionId:'notice'}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]}},{parent:`${root}/notice/v1`,structuredQuery:{from:[{collectionId:'data'}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]}}];
      }
    }catch{/* A malformed or unrelated token cannot select a user collection. */}
  }
  return profile?.queries||[];
}
export function profileUpdate(platform,message,previous={headers:{},routes:{},queries:[]}){
  if(!apiOrigins.has(message.origin))throw Error('UNAPPROVED_SESSION_ORIGIN');
  const origin=platform==='teapot'?'https://firestore.googleapis.com':allowed[platform]?.origin;
  if(origin!==message.origin&&!allowed[platform]?.alternates?.some(r=>r.origin===message.origin))throw Error('SESSION_PLATFORM_MISMATCH');
  const next=structuredClone(previous);next.headers={...next.headers};next.routes={...next.routes};next.queries=[...(next.queries||[])];
  next.headersByOrigin={...next.headersByOrigin,[message.origin]:{...next.headersByOrigin?.[message.origin]}};
  for(const [key,value] of Object.entries(message.headers||{}))if(headerNames.includes(key.toLowerCase())&&typeof value==='string'&&value.length<20000){next.headersByOrigin[message.origin][key.toLowerCase()]=value;if(origin===message.origin)next.headers[key.toLowerCase()]=value;}
  if(message.url&&platform!=='teapot'){try{const route=readRoute(platform,message.url);next.routes[new URL(route).pathname]=route}catch{/* A session header may come from another GET on the same API. */}}
  if(platform==='teapot'&&message.query){const q=message.query,parent=String(q.parent||''),query=q.structuredQuery,collections=query?.from?.map(x=>x.collectionId)||[];
    if(!/^projects\/chat-ai-7a275\/databases\/\(default\)\/documents(?:\/users\/[^/]+|\/notice\/v1)?$/.test(parent))throw Error('UNAPPROVED_QUERY_PARENT');
    if(!collections.length||!collections.every(x=>x==='notice'||x==='data'&&parent.endsWith('/notice/v1'))||query.from.some(x=>x.allDescendants===true))throw Error('UNAPPROVED_QUERY_COLLECTION');
    const normalized={parent,structuredQuery:query};if(!next.queries.some(x=>JSON.stringify(x)===JSON.stringify(normalized)))next.queries.push(normalized);
  }
  // A renewal secret is validated against its own kind before it is ever stored.
  if(message.renewal)next.renewal=renewalRecord(platform,message.renewal);
  // rplay sends its refresh token as an ordinary request header, so the capture already holds it.
  const rplayToken=platform==='rplay'&&next.headersByOrigin['https://api.rplay.live']?.['refresh-token'];
  if(rplayToken&&rplayToken!==next.renewal?.refreshToken)next.renewal=renewalRecord('rplay',{kind:'rplay',refreshToken:rplayToken});
  next.capturedAt=new Date().toISOString();return next;
}
// Only the token's own expiry claim, so a stale credential is visible without
// ever exposing the credential. A token with no readable exp reports null.
export function tokenExpiry(value){
  if(typeof value!=='string'||!value)return null;
  const part=(value.startsWith('Bearer ')?value.slice(7):value).split('.')[1];
  if(!part)return null;
  try{
    const padded=part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=');
    const claims=JSON.parse(atob(padded));
    return typeof claims.exp==='number'&&Number.isFinite(claims.exp)?new Date(claims.exp*1000).toISOString():null;
  }catch{return null}
}
// Every origin the platform authenticates against, so one leg's expiry cannot hide behind another's.
export function expiryByOrigin(profile){
  return Object.fromEntries(Object.entries(profile?.headersByOrigin||{})
    .map(([origin,headers])=>[origin,tokenExpiry(headers?.authorization)]).filter(([,exp])=>exp));
}
export function safeSessionSummary(profile){const expiry=expiryByOrigin(profile);return {connected:!!profile,capturedAt:profile?.capturedAt||null,routeCount:Object.keys(profile?.routes||{}).length,queryCount:teapotQueries(profile).length,hasAuthorization:!!profile?.headers?.authorization,expiresAt:tokenExpiry(profile?.headers?.authorization),expiresAtByOrigin:expiry,expired:Object.values(expiry).some(x=>Date.parse(x)<=Date.now()),canRenew:!!profile?.renewal}}
// The soonest expiry among the origins this profile can actually renew; null when
// nothing is renewable, so a platform is never renewed on another leg's clock.
export function renewableExpiry(profile){const kind=renewalKinds[profile?.renewal?.kind];if(!kind)return null;
  const expiry=expiryByOrigin(profile),times=kind.applyTo.map(origin=>expiry[origin]).filter(Boolean).sort();return times[0]||null}
