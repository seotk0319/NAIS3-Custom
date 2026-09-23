import {requestTrace,traceText,failureHint} from './client.mjs';
export class RenewalFailed extends Error{constructor(platform,reason,trace={}){super(`${platform}: ${reason}${Object.keys(trace).length?` · ${traceText(trace)}`:''}`);this.platform=platform;this.reason=reason;this.name='RenewalFailed';this.trace=trace}}
// Every renewal endpoint and request shape is fixed here and chosen by kind, never
// taken from the page: a captured value supplies the secret, never the destination.
// Each shape was read from that site's own public client code on 2026-09-22.
const bearerOf=(previous,token)=>{const raw=String(token).replace(/^Bearer\s+/i,'');return previous&&!/^Bearer\s/i.test(previous)?raw:`Bearer ${raw}`};
const param=(url,name)=>{try{return new URL(url).searchParams.get(name)||null}catch{return null}};
export const renewalKinds={
  supabase:{
    platforms:['eden'],applyTo:['https://jhbfalszdxacwjnrrvms.supabase.co'],
    endpoint:()=>'https://jhbfalszdxacwjnrrvms.supabase.co/auth/v1/token?grant_type=refresh_token',
    request({renewal,profile}){
      const apikey=profile.headersByOrigin?.['https://jhbfalszdxacwjnrrvms.supabase.co']?.apikey;
      if(!apikey)throw new RenewalFailed('eden','RENEWAL_APIKEY_MISSING',{kind:'supabase'});
      return {headers:{apikey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:renewal.refreshToken})};
    },
    read:data=>({token:data.access_token,refreshToken:data.refresh_token})
  },
  firebase:{
    platforms:['teapot'],applyTo:['https://firestore.googleapis.com'],
    endpoint:renewal=>`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(renewal.apiKey)}`,
    request:({renewal})=>({headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:renewal.refreshToken}).toString()}),
    read:data=>({token:data.id_token||data.access_token,refreshToken:data.refresh_token})
  },
  rplay:{
    platforms:['rplay'],applyTo:['https://api.rplay.live'],
    endpoint:()=>'https://api.rplay.live/rplay/account/refresh-token',
    request({renewal,profile}){
      // The account id already travels as a query parameter on the captured read route.
      const oid=param(profile.routes?.['/account/getuser'],'requestorOid');
      if(!oid)throw new RenewalFailed('rplay','RENEWAL_ACCOUNT_MISSING',{kind:'rplay'});
      return {headers:{'refresh-token':renewal.refreshToken,'platform-type':profile.headersByOrigin?.['https://api.rplay.live']?.['platform-type']||'Desktop','Content-Type':'application/json'},body:JSON.stringify({requestorOid:oid})};
    },
    read:data=>({token:data.accessToken,refreshToken:data.refreshToken})
  },
  crack:{
    platforms:['crack'],applyTo:['https://crack-api.wrtn.ai'],
    endpoint:()=>'https://crack-api.wrtn.ai/auth/v2/token/refresh',
    request:({renewal})=>({headers:{'Content-Type':'application/json',Platform:'web',Refresh:renewal.refreshToken},body:JSON.stringify({refreshToken:renewal.refreshToken})}),
    read:data=>({token:data.access_token,refreshToken:data.refresh_token})
  },
  elyn:{
    platforms:['elyn'],applyTo:['https://api.seoul.elyn.ai'],
    // Elyn's web client posts its refresh token to its own session endpoint and gets the
    // next access token with a rotated refresh token back under session (read 2026-09-23).
    endpoint:()=>'https://api.seoul.elyn.ai/api/v1/auth/me',
    request:({renewal})=>({headers:{'Content-Type':'application/json','X-Elyn-Client':'web'},body:JSON.stringify({refresh_token:renewal.refreshToken})}),
    read:data=>({token:data?.session?.access_token,refreshToken:data?.session?.refresh_token})
  },
  babe:{
    platforms:['babe'],applyTo:['https://api.babechatapi.com'],
    // Babe's own web client posts the refresh token as this endpoint's query parameter.
    endpoint:renewal=>`https://api.babechatapi.com/ko/api/auth/token/refresh?refresh_token=${encodeURIComponent(renewal.refreshToken)}`,
    request:()=>({headers:{}}),
    read:data=>({token:data.access_token,refreshToken:data.refresh_token})
  }
};
// The page supplies the secret, never the shape: an unknown kind, a wrong platform
// or an unusable key is rejected before anything is stored.
export function renewalRecord(platform,renewal){
  const kind=renewalKinds[renewal?.kind];
  if(!kind||!kind.platforms.includes(platform))throw Error('UNAPPROVED_RENEWAL_KIND');
  const refreshToken=renewal.refreshToken;
  // Supabase-style sessions (Eden, and Elyn's session endpoint) use opaque refresh tokens,
  // including Eden's observed 12-character values. Other providers keep their existing
  // validation; destinations remain fixed by kind.
  const opaque=renewal.kind==='supabase'||renewal.kind==='elyn',minLength=opaque?1:16;
  if(typeof refreshToken!=='string'||refreshToken.length<minLength||refreshToken.length>8192||opaque&&/\s/.test(refreshToken))throw Error('UNAPPROVED_RENEWAL_TOKEN');
  const record={kind:renewal.kind,refreshToken,capturedAt:new Date().toISOString()};
  if(renewal.kind==='firebase'){
    if(!/^[A-Za-z0-9_-]{20,80}$/.test(String(renewal.apiKey||'')))throw Error('UNAPPROVED_RENEWAL_KEY');
    record.apiKey=renewal.apiKey;
  }
  return record;
}
// Exchanges the stored refresh token for a fresh bearer. The refresh token is sent
// only to its own kind's endpoint and is never returned to a caller or a log.
export async function renewSession({platform,profile,fetchImpl=globalThis.fetch}){
  const renewal=profile?.renewal,kind=renewalKinds[renewal?.kind];
  if(!kind||!kind.platforms.includes(platform))throw new RenewalFailed(platform,'RENEWAL_UNAVAILABLE');
  const url=kind.endpoint(renewal),{headers,body}=kind.request({renewal,profile});
  const response=await fetchImpl(url,{method:'POST',headers,body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new RenewalFailed(platform,'RENEWAL_REJECTED',requestTrace(url,{kind:renewal.kind,status:response.status,...await failureHint(response)}));
  const data=await response.json().catch(()=>null),{token,refreshToken}=kind.read(data||{});
  if(typeof token!=='string'||!token)throw new RenewalFailed(platform,'RENEWAL_NO_TOKEN',requestTrace(url,{kind:renewal.kind,status:response.status}));
  const previous=profile.headersByOrigin?.[kind.applyTo[0]]?.authorization;
  // A rotated refresh token replaces the old one; a server that omits one keeps it in use.
  const rotated=typeof refreshToken==='string'&&refreshToken?refreshToken:renewal.refreshToken;
  return {authorization:bearerOf(previous,token),origins:kind.applyTo,renewal:{...renewal,refreshToken:rotated,renewedAt:new Date().toISOString()}};
}
