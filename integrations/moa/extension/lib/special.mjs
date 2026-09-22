import {notification,normalize,firestoreValue} from './model.mjs';
import {readRoute,SessionExpired,collectPages,endpoints,readError} from './client.mjs';
import {profileUpdate,teapotQueries} from './sessions.mjs';
async function jsonRequest(platform,url,transport,extra={},stage='read'){const response=await transport({platform,url,method:'GET',...extra});if(!response.ok)throw await readError(platform,response,url,stage);return response.json()}
export async function collectEden({profile,transport,commit,checkpoint,maxPages=40}){
  if(checkpoint?.next)await collectPages({platform:'eden',transport,commit:({checkpoint,...batch})=>commit({...batch,channel:'latest'}),startUrl:endpoints.eden,maxPages:1,stage:'latest'});
  await collectPages({platform:'eden',transport,commit,startUrl:endpoints.eden,checkpoint,maxPages,stage:'personal'});
  const routes=profile.routes||{},tables={};
  for(const name of ['notification_deliveries','global_notifications','user_read_tracking']){
    const seed=routes['/rest/v1/'+name];if(!seed)continue;
    let offset=0,hasNext=true;tables[name]=[];
    while(hasNext){const u=new URL(readRoute('eden',seed));u.searchParams.set('limit','100');u.searchParams.set('offset',String(offset));
      const rows=await jsonRequest('eden',u.href,transport,{},`joined:${name}`);if(!Array.isArray(rows))throw Error('UNRECOGNIZED_RESPONSE');tables[name].push(...rows);offset+=rows.length;hasNext=rows.length===100;if(offset>10000)throw Error('EDEN_WINDOW_LIMIT');
    }
  }
  if(!tables.notification_deliveries&&!tables.global_notifications)throw Error('SESSION_NOTICE_ROUTES_MISSING');
  const ids=[...new Set([...(tables.notification_deliveries||[]),...(tables.global_notifications||[])].map(x=>x.content_id).filter(Boolean))],contents=new Map();
  for(let i=0;i<ids.length;i+=100){const u=new URL('https://jhbfalszdxacwjnrrvms.supabase.co/rest/v1/notification_content');u.searchParams.set('select','id,kind,title,body,link_url');u.searchParams.set('id',`in.(${ids.slice(i,i+100).join(',')})`);const rows=await jsonRequest('eden',u.href,transport,{},'joined:notification_content');if(!Array.isArray(rows))throw Error('UNRECOGNIZED_RESPONSE');for(const row of rows)contents.set(row.id,row)}
  const read=new Set((tables.user_read_tracking||[]).map(x=>x.global_notification_id)),items=[],issues=[];
  for(const [table,channel] of [['notification_deliveries','personal'],['global_notifications','global']])for(const delivery of tables[table]||[]){const content=contents.get(delivery.content_id);if(!content){issues.push({code:'missing-content',id:delivery.id});continue}
    const result=notification('eden',{...content,id:delivery.id,created_at:delivery.created_at,read_at:delivery.read_at,is_read:channel==='personal'?delivery.is_read:tables.user_read_tracking?read.has(delivery.id):undefined},{channel});if(result.item)items.push(result.item);if(result.issue)issues.push(result.issue);
  }
  await commit({platform:'eden',channel:'joined',items,issues,received:items.length+issues.length,unmapped:items.filter(x=>x.classification.evidence==='unmapped').length,coverage:'captured-notice-routes'});
}
const decode=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
export function parseLuna(html){
  if(!/class=["'][^"']*alarm(?:List|Stats)/i.test(html))throw new SessionExpired('luna',{stage:'list',where:'lunatalk.chat/member/alarm',reason:'alarm-markup-absent'});
  const items=[],issues=[];
  for(const match of html.matchAll(/<li\b([^>]*\bdata-idx=["'][^"']+["'][^>]*)>([\s\S]*?)<\/li>/gi)){
    const attr=n=>match[1].match(new RegExp(`\\b${n}=["']([^"']*)["']`))?.[1],field=n=>decode(match[2].match(new RegExp(`<[^>]*class=["'][^"']*\\b${n}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,'i'))?.[1]);
    const type=field('aTit'),time=field('aTime').match(/(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})/),event=/공지|^관리자 알림$/.test(type)?'admin':/답글|대댓글/.test(type)?'reply':/댓글/.test(type)?'comment':/팔로/.test(type)?'follow':/좋아요/.test(type)?'like':'other';
    const result=notification('luna',{id:attr('data-idx'),title:field('aTxt'),body:type,type,created_at:time?`${time[1]}-${time[2]}-${time[3]}T${time[4]}:${time[5]}:00+09:00`:null,is_read:!(/\bnew\b/.test(attr('class')||'')),url:attr('data-url')?new URL(attr('data-url'),'https://lunatalk.chat').href:null},{classification:{event,type,evidence:event==='other'?'unmapped':'source-category'}});
    if(result.item){result.item.provenance='서버 알림 목록 직접 조회 · HTML 파싱';items.push(result.item)}if(result.issue)issues.push(result.issue);
  }
  return {items,issues,pages:Math.max(1,...[...html.matchAll(/\/member\/alarm\?page=(\d+)/g)].map(x=>+x[1]))};
}
export async function collectLuna({transport,commit,maxPages=40,checkpoint}){
  let page=checkpoint?.page||1,max=page;
  for(let count=0;count<maxPages&&page<=max;count++,page++){
    const response=await transport({platform:'luna',url:`https://lunatalk.chat/member/alarm?page=${page}`,method:'GET'});if(!response.ok)throw await readError('luna',response,response.url||`https://lunatalk.chat/member/alarm?page=${page}`,`list:p${page}`);
    const result=parseLuna(await response.text());max=Math.max(max,result.pages);await commit({platform:'luna',channel:'personal',...result,received:result.items.length,checkpoint:{page:page<max?page+1:null,next:page<max?`https://lunatalk.chat/member/alarm?page=${page+1}`:null,complete:page>=max},coverage:'server-html-list'});
  }
}
export async function collectTeapot({profile,transport,commit}){
  const queries=teapotQueries(profile);
  if(!queries.length)throw Error('SESSION_QUERIES_MISSING');
  for(const q of queries){
    profileUpdate('teapot',{origin:'https://firestore.googleapis.com',query:q});
    const url='https://firestore.googleapis.com/v1/'+q.parent+':runQuery';
    const rows=await jsonRequest('teapot',url,transport,{method:'POST',body:JSON.stringify({structuredQuery:q.structuredQuery}),headers:{'Content-Type':'application/json'}},q.parent.endsWith('/notice/v1')?'notice:public':'notice:personal');
    if(!Array.isArray(rows))throw Error('UNRECOGNIZED_RESPONSE');const items=[],issues=[];
    for(const entry of rows){if(!entry.document)continue;const d=entry.document,f=Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,firestoreValue(v)])),publicNotice=q.parent.endsWith('/notice/v1');
      const result=notification('teapot',{...f,id:d.name.split('/documents/')[1],created_at:f.time_created},{channel:publicNotice?'global':'personal',classification:publicNotice?{event:'admin',type:'public-notice',evidence:'source-collection'}:undefined});
      if(result.item)items.push(result.item);if(result.issue)issues.push(result.issue);
    }
    // Firestore may return more than the local ingestion limit in one response.
    // Commit bounded chunks; never silently drop documents past the first batch.
    for(let offset=0;offset<Math.max(1,items.length);offset+=100){const part=items.slice(offset,offset+100);await commit({platform:'teapot',channel:q.parent.endsWith('/notice/v1')?'global':'personal',items:part,issues:offset===0?issues:[],received:part.length,unmapped:part.filter(x=>x.classification.evidence==='unmapped').length,checkpoint:{complete:offset+100>=items.length,next:null},coverage:'notice-query-response'});}
  }
}
