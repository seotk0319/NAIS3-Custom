(() => {
  let enabled=false,renewalOnly=false;
  window.addEventListener('message',e=>{if(enabled&&e.source===window&&e.origin===location.origin&&e.data?.source==='moa-api-profile'&&(!renewalOnly||e.data.platform==='babe'&&e.data.profile?.renewal?.kind==='babe'))chrome.runtime.sendMessage({type:'session-profile',platform:e.data.platform,profile:e.data.profile}).catch(()=>{})});
  async function start(){const result=await chrome.runtime.sendMessage({type:'session-ready'}).catch(()=>null);if(result?.enabled){renewalOnly=!!result.renewalOnly;enabled=true;window.postMessage({source:'moa-api-start'},location.origin)}}
  start();
})();
