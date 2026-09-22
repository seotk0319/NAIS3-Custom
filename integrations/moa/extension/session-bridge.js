(() => {
  let enabled=false;
  window.addEventListener('message',e=>{if(enabled&&e.source===window&&e.origin===location.origin&&e.data?.source==='moa-api-profile')chrome.runtime.sendMessage({type:'session-profile',platform:e.data.platform,profile:e.data.profile}).catch(()=>{})});
  async function start(){const result=await chrome.runtime.sendMessage({type:'session-ready'}).catch(()=>null);if(result?.enabled){enabled=true;window.postMessage({source:'moa-api-start'},location.origin)}}
  start();
})();
