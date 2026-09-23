// Session handoff only. Request bodies and account responses are never exported.
(() => {
  const origins={eden:'https://jhbfalszdxacwjnrrvms.supabase.co',babe:'https://api.babechatapi.com',elyn:'https://api.seoul.elyn.ai',neko:'https://www.nekochat.xyz',crack:'https://crack-api.wrtn.ai',rplay:'https://api.rplay.live',genit:'https://api.genit.ai',teapot:'https://firestore.googleapis.com'};
  const hosts={'www.eden-chat.com':'eden','babechat.ai':'babe','elyn.ai':'elyn','www.nekochat.xyz':'neko','crack.wrtn.ai':'crack','rplay.live':'rplay','genit.ai':'genit','teapotchat.com':'teapot'};
  const platform=hosts[location.hostname];if(!platform)return;let active=false;const pending=[];
  const allowedHeaders=new Set(['authorization','apikey','x-api-key','platform-type','refresh-token']);
  const emit=profile=>{if(active)window.postMessage({source:'moa-api-profile',platform,profile},location.origin);else if(pending.length<50)pending.push(profile)};
  function capture(raw,headers,method,body){
    let url;try{url=new URL(raw,location.href)}catch{return}if(url.origin!==origins[platform]&&!(platform==='eden'&&url.origin==='https://www.eden-chat.com'))return;
    const filtered={};new Headers(headers||{}).forEach((value,key)=>{if(allowedHeaders.has(key))filtered[key]=value});
    if(platform==='teapot'&&url.pathname.endsWith('/Listen/channel')){
      const envelope=typeof body==='string'?body:body instanceof URLSearchParams?body.toString():url.searchParams.get('$req')||'';
      const params=new URLSearchParams(envelope),encodedHeaders=params.get('headers')||url.searchParams.get('$httpHeaders');
      if(encodedHeaders)for(const line of encodedHeaders.split(/\r?\n/)){const colon=line.indexOf(':');if(colon>0){const name=line.slice(0,colon).trim().toLowerCase();if(allowedHeaders.has(name))filtered[name]=line.slice(colon+1).trim();}}
      if(envelope)body=envelope;
    }
    if(method==='GET'||platform==='teapot'&&/\/Listen\/channel$|:runQuery$|:batchGet$/.test(url.pathname))emit({origin:url.origin,url:url.href,headers:filtered});
    if(body instanceof URLSearchParams)body=body.toString();
    if(platform==='teapot'&&url.pathname.endsWith(':runQuery')&&typeof body==='string'){
      try{const q=JSON.parse(body).structuredQuery,parent=url.pathname.replace(/^\/v1\//,'').replace(/:runQuery$/,'');if(q?.from?.some(x=>x.collectionId==='notice'||x.collectionId==='data'&&parent.endsWith('/notice/v1')))emit({origin:url.origin,headers:filtered,query:{parent,structuredQuery:q}})}catch{}
    }
    if(platform==='teapot'&&url.pathname.endsWith('/Listen/channel')&&typeof body==='string'){
      for(const [key,value] of new URLSearchParams(body)){if(!key.endsWith('___data__'))continue;try{const q=JSON.parse(value).addTarget?.query;if(q&&q.structuredQuery?.from?.some(x=>x.collectionId==='notice'||x.collectionId==='data'&&q.parent?.endsWith('/notice/v1')))emit({origin:url.origin,headers:filtered,query:q})}catch{}}
    }
  }
  const fetchNative=window.fetch.bind(window);window.fetch=function(input,init){
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    try{
      const request=!!input&&typeof input.url==='string'&&typeof input.clone==='function';
      const url=request?input.url:input,headers=init?.headers||(request?input.headers:null);
      capture(url,headers,method,init?.body);
      if(platform==='teapot'&&method==='POST'&&request&&init?.body===undefined&&/^https:\/\/firestore\.googleapis\.com\//.test(input.url)&&/\/Listen\/channel(?:\?|$)|:runQuery(?:\?|$)/.test(input.url)){
        input.clone().text().then(body=>{if(body.length<=2000000)capture(url,headers,method,body)}).catch(()=>{});
      }
    }catch{}
    return fetchNative(input,init);
  };
  const proto=XMLHttpRequest.prototype,open=proto.open,send=proto.send,set=proto.setRequestHeader,requests=new WeakMap();
  proto.open=function(method,url,...rest){requests.set(this,{method:String(method).toUpperCase(),url,headers:{}});return open.call(this,method,url,...rest)};
  proto.setRequestHeader=function(key,value){const q=requests.get(this);if(q&&allowedHeaders.has(key.toLowerCase()))q.headers[key]=value;return set.call(this,key,value)};
  proto.send=function(body){const q=requests.get(this);if(q)try{capture(q.url,q.headers,q.method,body)}catch{}return send.call(this,body)};
  // Sites keep a long-lived refresh token in their own storage or cookies.
  // Reading only that site's token lets a later collection renew its bearer
  // without opening a tab. Nothing else in storage is read or exported.
  const sent=new Set();
  const emitRenewal=renewal=>{const key=`${renewal.kind}:${renewal.refreshToken.slice(-12)}`;if(sent.has(key))return;sent.add(key);emit({origin:origins[platform],renewal})};
  // Supabase refresh tokens are opaque; Eden currently issues 12-character values.
  // Keep the size/whitespace guard without inventing a minimum token length.
  const validSupabaseRefresh=token=>typeof token==='string'&&token.length>0&&token.length<=8192&&!/\s/.test(token);
  function scanLocalStorage(){
    if(platform!=='eden')return;
    try{for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!/^sb-/.test(key||''))continue;
      let parsed;try{parsed=JSON.parse(localStorage.getItem(key))}catch{continue}
      const token=parsed?.refresh_token||parsed?.currentSession?.refresh_token;
      if(validSupabaseRefresh(token))emitRenewal({kind:'supabase',refreshToken:token});
    }}catch{/* Storage may be blocked; a missing renewal is not a capture failure. */}
  }
  async function scanFirebase(){
    if(platform!=='teapot'||typeof indexedDB==='undefined'||typeof indexedDB.databases!=='function')return;
    try{
      // Opening a database by name would create an empty one, so only read an existing store.
      if(!(await indexedDB.databases()).some(db=>db.name==='firebaseLocalStorageDb'))return;
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('firebaseLocalStorageDb');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('blocked'))});
      try{
        if(!db.objectStoreNames.contains('firebaseLocalStorage'))return;
        const rows=await new Promise((resolve,reject)=>{const request=db.transaction('firebaseLocalStorage','readonly').objectStore('firebaseLocalStorage').getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error)});
        for(const row of rows){const value=row?.value,token=value?.stsTokenManager?.refreshToken;
          if(typeof token==='string'&&token.length>=16&&typeof value.apiKey==='string')emitRenewal({kind:'firebase',apiKey:value.apiKey,refreshToken:token});}
      }finally{db.close()}
    }catch{/* An unreadable store leaves the account on manual reconnection. */}
  }
  // Supabase's SSR client keeps the session in a cookie rather than localStorage, and
  // splits a long one across .0, .1 … chunks that are joined before decoding.
  function supabaseRefresh(raw){
    for(const attempt of [raw,(()=>{try{return decodeURIComponent(raw)}catch{return ''}})()]){
      if(!attempt)continue;
      let text=attempt;
      if(text.startsWith('base64-')){
        // Supabase's SSR client defaults to base64url, whose - and _ break plain atob.
        const encoded=text.slice(7).replace(/-/g,'+').replace(/_/g,'/');
        const padded=encoded.padEnd(Math.ceil(encoded.length/4)*4,'=');
        try{text=new TextDecoder().decode(Uint8Array.from(atob(padded),c=>c.charCodeAt(0)))}catch{continue}
      }
      try{
        const parsed=JSON.parse(text),token=parsed?.refresh_token||parsed?.currentSession?.refresh_token;
        if(validSupabaseRefresh(token))return token;
      }catch{/* Another encoding of the same cookie may still parse. */}
    }
    return null;
  }
  function scanCookie(){
    // Only this platform's own session cookies on its own origin are read.
    if(platform!=='crack'&&platform!=='eden'&&platform!=='babe')return;
    try{
      const jar=new Map();
      for(const part of String(document.cookie||'').split(';')){
        const split=part.indexOf('=');if(split<0)continue;
        jar.set(part.slice(0,split).trim(),part.slice(split+1).trim());
      }
      if(platform==='crack'){
        const token=decodeURIComponent(jar.get('refresh_token')||'');
        if(token.length>=16)emitRenewal({kind:'crack',refreshToken:token});
        return;
      }
      if(platform==='babe'){
        // The site's own session provider reads bc__session_refresh and rotates it.
        const token=decodeURIComponent(jar.get('bc__session_refresh')||'');
        if(token.length>=16&&token.length<=8192&&!/\s/.test(token))emitRenewal({kind:'babe',refreshToken:token});
        return;
      }
      const bases=new Set();
      for(const name of jar.keys()){const found=/^(sb-[a-z0-9]+-auth-token)(?:\.\d+)?$/.exec(name);if(found)bases.add(found[1])}
      for(const base of bases){
        let raw=jar.get(base)||'';
        for(let index=0;jar.has(`${base}.${index}`);index++)raw+=jar.get(`${base}.${index}`);
        const token=supabaseRefresh(raw);
        if(token)emitRenewal({kind:'supabase',refreshToken:token});
      }
    }catch{/* An unreadable cookie leaves the account on manual reconnection. */}
  }
  // The site may write its session after load, so look again across the connection window.
  const scan=()=>{scanLocalStorage();scanCookie();scanFirebase()};
  window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin||e.data?.source!=='moa-api-start')return;active=true;for(const profile of pending.splice(0))emit(profile);scan();if(typeof setTimeout==='function')for(const delay of [3000,10000,25000,45000])setTimeout(scan,delay)});
})();
