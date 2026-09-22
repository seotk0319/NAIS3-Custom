const $=id=>document.getElementById(id);
async function call(message){const r=await chrome.runtime.sendMessage(message);if(r?.error)throw Error(r.error);return r}
async function refresh(){const s=await call({type:'status'});$('pair').hidden=s.paired;$('connected').hidden=!s.paired;$('status').textContent=s.lastError||(s.paired?`${s.version||''} · ${s.enabled?'API 수집 사용 중':'수집 일시정지'} · 연결 중 ${s.connecting||0}곳 · 세션 ${Object.values(s.sessions||{}).filter(x=>x.connected).length}곳`:'연결 코드는 이 컴퓨터의 대시보드에서 확인해 주세요.')}
for(const [id,type] of [['connect','pair'],['sessions','connect'],['sync','sync']])$(id).onclick=async()=>{try{$(id).disabled=true;$('status').textContent='연결을 확인하고 있어요…';await call({type,code:$('code').value});$('code').value='';await refresh()}catch(e){$('status').textContent=e.message}finally{$(id).disabled=false}};
refresh().catch(e=>$('status').textContent=e.message);
setInterval(()=>refresh().catch(()=>{}),2000);
