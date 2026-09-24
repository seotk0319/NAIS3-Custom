import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {normalize,notification,refineNotification,refineNotifications,workLink} from '../src/main/notifications/core/api/model.mjs';
import {collectPages,readRoute,SessionExpired,readError,renewable} from '../src/main/notifications/core/api/client.mjs';
import {profileUpdate,safeSessionSummary,teapotQueries,tokenExpiry,expiryByOrigin,renewableExpiry} from '../src/main/notifications/core/api/sessions.mjs';
import {renewSession,renewalRecord,RenewalFailed} from '../src/main/notifications/core/api/renewal.mjs';
import {createStore} from '../src/main/notifications/core/store.mjs';
import {collectEden,collectLuna,collectTeapot,parseLuna} from '../src/main/notifications/core/api/special.mjs';
const response=value=>new Response(JSON.stringify(value),{status:200});
const teaToken=(overrides={})=>'test.'+Buffer.from(JSON.stringify({iss:'https://securetoken.google.com/chat-ai-7a275',aud:'chat-ai-7a275',sub:'test-self',...overrides})).toString('base64url')+'.test';

test('Teapot own-account query uses only the observed Firebase issuer and audience',()=>{
  const profile={headers:{authorization:'Bearer '+teaToken()},queries:[]};
  const queries=teapotQueries(profile);assert.equal(queries.length,2);assert.ok(queries[0].parent.endsWith('/users/test-self'));assert.equal(queries[0].structuredQuery.from[0].collectionId,'notice');assert.ok(queries[1].parent.endsWith('/notice/v1'));
  for(const overrides of [{sub:'other/notice'},{aud:'other-project'},{iss:'https://unrelated.example'}, {sub:''}])assert.deepEqual(teapotQueries({headers:{authorization:'Bearer '+teaToken(overrides)}}),[]);
  assert.deepEqual(teapotQueries({headers:{authorization:'Bearer broken'}}),[]);
  assert.equal(JSON.stringify(safeSessionSummary(profile)).includes(teaToken()),false);
});

test('Teapot large responses are committed without dropping documents and raw notification fields survive storage',async()=>{
  const saved=[],profile={headers:{authorization:'Bearer '+teaToken()},queries:[]};
  await collectTeapot({profile,transport:async r=>response(r.url.includes('/users/')?Array.from({length:1001},(_,i)=>({document:{name:`projects/chat-ai-7a275/databases/(default)/documents/users/test-self/notice/${i}`,fields:{type:{stringValue:'unseen'},special_field:{stringValue:'retained'}}}})):[]),commit:async b=>saved.push(b)});
  assert.equal(saved.reduce((n,b)=>n+b.items.length,0),1001);assert.ok(saved.every(b=>b.items.length<=100));assert.equal(new Set(saved.flatMap(b=>b.items.map(i=>i.id))).size,1001);
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-raw-notice-')),store=await createStore(dir);await store.ingest({...saved[0],transport:'direct-api',status:'partial'});
  const view=await (await createStore(dir)).view();assert.equal(view.items[0].sourceData.special_field,'retained');assert.equal(view.items[0].event,'other');
  await store.heartbeat({version:'test',sessions:{teapot:{connected:true,queryCount:2,authorization:'must-not-leak'}}});assert.equal(JSON.stringify((await store.view()).collector).includes('must-not-leak'),false);
});
test('RPLAY preserves actual notification identity, work, actor, timestamp and reply',()=>{
  const {item}=notification('rplay',{notificationId:'n1',type:'storychatsCommentByUser',contentOid:'w1',remark:'work',actorOid:'a1',actorNickname:'author',commentText:'comment',commentOid:'c1',isReply:true,date:'2026-09-13T23:19:14.010Z'});
  assert.equal(item.event,'reply');assert.equal(item.kind,'comment');assert.equal(item.work.id,'w1');assert.equal(item.actor.id,'a1');assert.equal(item.commentId,'c1');assert.equal(item.unread,null);assert.equal(item.at,'2026-09-13T23:19:14.010Z');
});
test('classification uses source fields, preserves unknown kinds, and never scans user comments',()=>{
  assert.equal(notification('babe',{id:1,type:'commentLikeV2',body:'comment'}).item.event,'like');
  assert.equal(notification('babe',{id:2,type:'characterReplies'}).item.event,'reply');
  const unknown=notification('genit',{id:3,notification_type:'new_kind',payload:{comment_snippet:'운영 공지 좋아요 팔로우'}}).item;assert.equal(unknown.event,'other');assert.ok(unknown.classification.warnings.includes('unmapped-type'));
  const follow=notification('genit',{id:4,notification_type:'new_follow_kind',category:'follows',actor:{id:1,nickname:'name'}}).item;assert.equal(follow.event,'follow');assert.equal(follow.actor.id,'1');
});
test('bounded collection continues without skipping and rejects external pagination destinations',async()=>{
  const calls=[],saved=[];const transport=async req=>{calls.push(req);const page=+(new URL(req.url).searchParams.get('page')||1);return response({results:[{id:page,notification_type:'creator_character_comment',payload:{comment_snippet:'x'}}],next:page<3?`https://api.genit.ai/api/notifications/?page=${page+1}`:null})};
  const first=await collectPages({platform:'genit',transport,commit:async b=>saved.push(b),maxPages:1});assert.equal(first.checkpoint.complete,false);
  const second=await collectPages({platform:'genit',transport,commit:async b=>saved.push(b),checkpoint:first.checkpoint,maxPages:5});assert.equal(second.checkpoint.complete,true);assert.deepEqual(saved.map(x=>x.items[0].sourceId),['1','2','3']);assert.ok(calls.every(x=>x.method==='GET'));
  await assert.rejects(collectPages({platform:'genit',transport:async()=>response({results:[],next:'https://evil.example/api/notifications/'}),commit:async()=>{}}),/UNAPPROVED/);
});
test('failed commit does not request the next page; expired sessions are not empty lists',async()=>{
  let requests=0;await assert.rejects(collectPages({platform:'neko',transport:async()=>{requests++;return response({notifications:[{notificationId:'1',type:'follow'}],pagination:{hasMore:true,nextCursor:'cursor'}})},commit:async()=>{throw Error('DISK_FULL')}}),/DISK_FULL/);assert.equal(requests,1);
  await assert.rejects(collectPages({platform:'neko',transport:async()=>new Response('',{status:401}),commit:async()=>{}}),SessionExpired);
  assert.throws(()=>readRoute('genit','https://api.genit.ai/api/notifications/mark-tab-read/'),/UNAPPROVED/);
});
test('session routes, header minimization and Firestore collection boundaries',()=>{
  const profile=profileUpdate('genit',{origin:'https://api.genit.ai',url:'https://api.genit.ai/api/notifications/?lang=ko',headers:{Authorization:'test-only-value',Cookie:'must-not-copy'}});assert.equal(profile.headers.cookie,undefined);assert.equal(JSON.stringify(safeSessionSummary(profile)).includes('test-only-value'),false);
  assert.throws(()=>profileUpdate('genit',{origin:'https://evil.example',headers:{}}),/UNAPPROVED/);
  const query={parent:'projects/chat-ai-7a275/databases/(default)/documents/users/u',structuredQuery:{from:[{collectionId:'notice'}]}};assert.equal(profileUpdate('teapot',{origin:'https://firestore.googleapis.com',query}).queries.length,1);
  assert.throws(()=>profileUpdate('teapot',{origin:'https://firestore.googleapis.com',query:{...query,structuredQuery:{from:[{collectionId:'chats'}]}}}),/UNAPPROVED/);
});
test('API ingestion retains the integration contract and separates legacy snapshots',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-api-store-')),store=await createStore(dir);
  await store.ingest({platform:'rplay',channel:'screen',snapshot:true,items:[{id:'slot:1',title:'old',stableId:false}],status:'partial'});
  const batch=normalize('rplay',{notifications:[{notificationId:'n',type:'storychatsCommentByUser',contentOid:'work',actorOid:'actor',commentText:'text',isReply:true}]});
  await store.ingest({platform:'rplay',transport:'direct-api',...batch,status:'partial'});await store.ingest({platform:'rplay',transport:'direct-api',...batch,status:'partial'});
  const view=await (await createStore(dir)).view();assert.equal(view.mode,'direct-api');assert.equal(view.items.length,1);assert.equal(view.items[0].actor.id,'actor');assert.equal(view.items[0].work.id,'work');assert.equal(view.items[0].event,'reply');assert.equal(view.items[0].unread,null);
});
test('Eden joins preserve separate delivery identities and unknown global read state',async()=>{
  const root='https://jhbfalszdxacwjnrrvms.supabase.co/rest/v1/',saved=[];
  await collectEden({profile:{routes:{'/rest/v1/notification_deliveries':root+'notification_deliveries?recipient_id=eq.test','/rest/v1/global_notifications':root+'global_notifications'}},transport:async r=>{
    assert.equal(r.method,'GET');if(new URL(r.url).pathname==='/api/notifications')return response({notifications:[]});const table=new URL(r.url).pathname.split('/').pop();return response(table==='notification_content'?[{id:'c',title:'notice',kind:'admin_system'}]:table==='notification_deliveries'?[{id:'d1',content_id:'c',is_read:false},{id:'d2',content_id:'c',is_read:true}]:[{id:'g1',content_id:'c'}]);
  },commit:async b=>saved.push(b)});
  const joined=saved.find(b=>b.channel==='joined');assert.deepEqual(joined.items.map(x=>x.sourceId),['d1','d2','g1']);assert.deepEqual(joined.items.map(x=>x.unread),[true,false,null]);assert.equal(joined.items[2].channel,'global');assert.equal(joined.checkpoint,undefined);
});

test('observed Eden API metadata and offset cursor retain work, actor, reply and source identity',async()=>{
  const raw={id:'comment:original',source_id:'original',source_table:'work_comments',type:'reply',metadata:{work_id:'w',actor_id:'a',actor_nickname:'name',content_preview:'body'},is_read:false,created_at:'2026-09-22T00:00:00Z'};
  const n=notification('eden',raw).item;assert.equal(n.event,'reply');assert.equal(n.actor.id,'a');assert.equal(n.commentId,'original');assert.equal(n.work.url,'https://www.eden-chat.com/works/w');assert.equal(n.body,'body');
  const saved=[],urls=[];await collectPages({platform:'eden',startUrl:'https://www.eden-chat.com/api/notifications?limit=2&offset=0',transport:async r=>{urls.push(r.url);return response({notifications:new URL(r.url).searchParams.get('offset')==='0'?[raw,{...raw,id:'second'}]:[]})},commit:async b=>saved.push(b)});
  assert.equal(urls.length,2);assert.equal(new URL(urls[1]).searchParams.get('offset'),'2');assert.equal(saved[1].checkpoint.complete,true);
});

test('source labels distinguish replies, operator messages and creator/work follows',()=>{
  assert.equal(notification('genit',{id:'g',notification_type:'comment_reply',category:'comments'}).item.event,'reply');
  assert.equal(notification('genit',{id:'g',notification_type:'customer_inquiry_answered'}).item.event,'admin');
  const story=notification('crack',{id:'c',category:'social',push:{title:'누군가가 작품명의 팬이 되었어요!'},webLink:'https://crack.wrtn.ai/detail/6a00000000000000000c0c01'}).item;
  assert.equal(story.event,'follow');assert.equal(story.work.title,'작품명');assert.equal(story.work.id,'6a00000000000000000c0c01');
  assert.equal(notification('crack',{id:'c',push:{title:'누군가 당신의 팬이 되었어요!'}}).item.event,'follow');
  assert.equal(parseLuna('<div class="alarmStats"></div><li data-idx="1"><div class="aTit">관리자 알림</div></li>').items[0].event,'admin');
});

test('Babe observed nickname, creator identity and relative notification link survive normalization',()=>{
  const n=notification('babe',{id:'b',type:'characterReplies',data:{nickname:'writer',creatorId:'creator',characterId:'work'},redirectUrl:'character/u/work/profile?tab=comments',isRead:false}).item;
  assert.deepEqual(n.actor,{id:'creator',name:'writer'});assert.equal(n.event,'reply');assert.equal(n.url,'https://babechat.ai/character/u/work/profile?tab=comments');assert.equal(n.work.url,n.url);
  const bad=notification('babe',{id:'b',type:'follow',redirectUrl:'https://unrelated.example/creator/id'}).item;assert.equal(bad.url,null);
});

test('Teapot source tag, comment identity and link reclassify saved raw notifications',()=>{
  const n=notification('teapot',{id:'users/self/notice/n',tag:'댓글',by_uid:'u',by_name:'name',content:'본문',link:'/character/work?comment_id=comment',is_read:true}).item;
  assert.equal(n.event,'comment');assert.equal(n.sourceType,'댓글');assert.equal(n.commentId,'comment');assert.equal(n.unread,false);assert.equal(n.url,'https://teapotchat.com/character/work?comment_id=comment');assert.deepEqual(n.actor,{id:'u',name:'name'});assert.equal(n.work.id,'work');
  const old={...n,event:'other',sourceType:''};assert.equal(refineNotification(old).event,'comment');
  assert.equal(notification('teapot',{id:'f',tag:'후원',content:'댓글 좋아요'}).item.event,'other');
  const admin=notification('teapot',{id:'g',tag:'이벤트'},{channel:'global',classification:{event:'admin',type:'public-notice',evidence:'source-collection'}}).item;assert.equal(refineNotification(admin).sourceType,'이벤트');
});

test('Teapot public notice receipts join read state without duplicate display or deleting original records',()=>{
  const global=notification('teapot',{id:'notice/v1/data/n',tag:'이벤트',content:'notice'},{channel:'global'}).item;
  const receipt=notification('teapot',{id:'users/self/notice/n',tag:'이벤트',content:'notice',is_read:true}).item;
  const removed=notification('teapot',{id:'users/self/notice/deleted',tag:'댓글',is_deleted:true}).item;
  const rows=refineNotifications([global,receipt,removed]);assert.equal(rows.length,1);assert.equal(rows[0].unread,false);assert.equal(rows[0].readReceiptId,receipt.sourceId);assert.equal(global.unread,null);
  assert.equal(refineNotifications([receipt]).length,1);
});

test('stored source types can be reclassified without refetch, data loss or body-word guesses',()=>{
  const stored={...notification('eden',{id:'1',type:'unseen'}).item,sourceType:'guestbook_reply',body:'공지 좋아요 팔로우',actor:{id:'a',name:'name'},unread:false};
  const fixed=refineNotification(stored);assert.equal(fixed.event,'reply');assert.equal(fixed.kind,'comment');assert.equal(fixed.body,stored.body);assert.deepEqual(fixed.actor,stored.actor);assert.equal(fixed.unread,false);assert.equal(stored.event,'other');assert.ok(!fixed.classification.warnings.includes('unmapped-type'));
  const unknown={...stored,sourceType:'unseen'};assert.equal(refineNotification(unknown),unknown);
});

test('session headers remain scoped to the API origin that supplied them',()=>{
  let p=profileUpdate('eden',{origin:'https://jhbfalszdxacwjnrrvms.supabase.co',headers:{authorization:'supabase-test'}});
  p=profileUpdate('eden',{origin:'https://www.eden-chat.com',url:'https://www.eden-chat.com/api/notifications?limit=60&offset=0',headers:{}} ,p);
  assert.equal(p.headersByOrigin['https://www.eden-chat.com'].authorization,undefined);
  assert.equal(p.headersByOrigin['https://jhbfalszdxacwjnrrvms.supabase.co'].authorization,'supabase-test');
  assert.equal(new URL(p.routes['/api/notifications']).hostname,'www.eden-chat.com');
});

test('Firestore Request and URLSearchParams bodies capture only notice queries without consuming the original request',async()=>{
  const source=await readFile(new URL('../src/main/notifications/core/api/capture.js',import.meta.url),'utf8'),sent=[],listeners={},originalBodies=[];
  const location={hostname:'teapotchat.com',origin:'https://teapotchat.com',href:'https://teapotchat.com/'},scheduled=[];
  class XHR{open(){}setRequestHeader(){}send(){}}
  const window={fetch:async(input,init)=>{originalBodies.push(input instanceof Request?await input.text():String(init?.body||''));return new Response('{}')},postMessage:message=>sent.push(message),addEventListener:(type,fn)=>{listeners[type]=fn}};
  vm.runInNewContext(source,{window,location,URL,URLSearchParams,Headers,Request,XMLHttpRequest:XHR,setTimeout:(fn,delay)=>{scheduled.push(delay);return 0}});
  listeners.message({source:window,origin:location.origin,data:{source:'moa-api-start'}});
  // Renewal discovery retries across the connection window and survives a page with no storage.
  assert.deepEqual(scheduled,[3000,10000,25000,45000]);
  const query={parent:'projects/chat-ai-7a275/databases/(default)/documents/users/self',structuredQuery:{from:[{collectionId:'notice'}]}};
  const body=new URLSearchParams({count:'1',req0___data__:JSON.stringify({addTarget:{query}})}),url='https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel';
  await window.fetch(url,{method:'POST',body});await window.fetch(new Request(url,{method:'POST',body}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(originalBodies,[body.toString(),body.toString()]);assert.equal(sent.filter(x=>x.profile.query).length,2);
  await window.fetch(url,{method:'POST',body:new URLSearchParams({req0___data__:JSON.stringify({addTarget:{query:{...query,structuredQuery:{from:[{collectionId:'chats'}]}}}})})});
  assert.equal(sent.filter(x=>x.profile.query).length,2);
  // Observed WebChannel handshake: auth headers are URL-encoded inside the body.
  const handshake=new URLSearchParams(body);handshake.set('headers','X-Goog-Api-Client:test\r\nAuthorization:Bearer '+teaToken()+'\r\nContent-Type:text/plain\r\n');
  const underlying=new Request(url,{method:'POST',body:handshake});
  const otherRealmRequest={url:underlying.url,method:underlying.method,headers:underlying.headers,clone:()=>underlying.clone()};
  await window.fetch(otherRealmRequest);await new Promise(resolve=>setImmediate(resolve));
  const authProfile=sent.find(x=>x.profile.headers.authorization==='Bearer '+teaToken());assert.ok(authProfile);assert.deepEqual(Object.keys(authProfile.profile.headers),['authorization']);
  assert.equal(teapotQueries(profileUpdate('teapot',authProfile.profile)).length,2);
  const fast=new URL(url);fast.searchParams.set('$req',handshake.toString());await window.fetch(fast.href);
  assert.equal(sent.filter(x=>x.profile.query).length,4);
});
test('Luna uses direct GET only and commits HTML-derived original IDs',async()=>{
  const calls=[],saved=[];await collectLuna({transport:async r=>{calls.push(r);return new Response('<div class="alarmStats"></div><li class="aCont new" data-idx="123" data-url="/b/v/notice/1"><div class="aTit">새 공지</div><div class="aTxt">title</div><div class="aTime">2026.09.21 15:53</div></li><script>throw Error("never execute")</script>')},commit:async b=>saved.push(b)});
  assert.equal(calls[0].method,'GET');assert.equal(saved[0].items[0].sourceId,'123');assert.equal(saved[0].items[0].event,'admin');assert.equal(saved[0].items[0].at,'2026-09-21T06:53:00.000Z');assert.equal(saved[0].checkpoint.complete,true);
});
test('Firestore collection executes only the validated read query',async()=>{
  const saved=[],calls=[],profile={queries:[{parent:'projects/chat-ai-7a275/databases/(default)/documents/notice/v1',structuredQuery:{from:[{collectionId:'data'}],limit:5}}]};
  await collectTeapot({profile,transport:async r=>{calls.push(r);return response([{document:{name:'projects/chat-ai-7a275/databases/(default)/documents/notice/v1/data/n1',fields:{title:{stringValue:'notice'},time_created:{timestampValue:'2026-09-22T01:00:00Z'}}}}])},commit:async b=>saved.push(b)});
  assert.equal(calls[0].method,'POST');assert.ok(calls[0].url.endsWith(':runQuery'));assert.equal(saved[0].items[0].event,'admin');assert.equal(saved[0].items[0].unread,null);
  await assert.rejects(collectTeapot({profile:{queries:[{...profile.queries[0],structuredQuery:{from:[{collectionId:'chats'}]}}]},transport:async()=>{throw Error('must not run')},commit:async()=>{}}),/UNAPPROVED/);
});

test('failure diagnostics separate 401, 403 and 5xx without exposing the request query',async()=>{
  const reply=(status,body,type='application/json')=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':type}});
  const failure=async(status,body,type)=>{let caught;
    await collectPages({platform:'crack',transport:async()=>reply(status,body,type),commit:async()=>{},startUrl:'https://crack-api.wrtn.ai/crack-api/alarm?page=1&limit=20&account=only-for-the-request'}).catch(e=>{caught=e});
    assert.ok(caught,`HTTP ${status} must not look like an empty list`);return caught};
  const unauthorized=await failure(401,{message:'jwt expired'});
  assert.ok(unauthorized instanceof SessionExpired);assert.equal(unauthorized.trace.status,401);
  assert.equal(unauthorized.trace.where,'crack-api.wrtn.ai/crack-api/alarm');assert.match(unauthorized.message,/jwt expired/);
  const forbidden=await failure(403,{code:'FORBIDDEN'});
  assert.ok(forbidden instanceof SessionExpired);assert.equal(forbidden.trace.status,403);
  // A server error that merely mentions a session must not be reported as a login problem.
  const broken=await failure(500,{message:'SESSION_INVALID'});
  assert.equal(broken instanceof SessionExpired,false);assert.match(broken.message,/HTTP_500/);
  assert.equal(broken.trace.status,500);assert.equal(broken.trace.stage,'list:p1');
  assert.equal((await failure(502,'<html>gateway</html>','text/html')).trace.type,'text/html');
  for(const error of [unauthorized,forbidden,broken])assert.equal(error.message.includes('only-for-the-request'),false);
});
test('token expiry is visible per origin while the token itself stays hidden',()=>{
  const past=Math.floor(Date.now()/1000)-60,future=Math.floor(Date.now()/1000)+3600,stale='Bearer '+teaToken({exp:past});
  const profile={headers:{authorization:stale},headersByOrigin:{'https://firestore.googleapis.com':{authorization:stale},'https://www.eden-chat.com':{authorization:'Bearer '+teaToken({exp:future})}}};
  assert.equal(tokenExpiry(stale),new Date(past*1000).toISOString());
  assert.deepEqual(Object.keys(expiryByOrigin(profile)),['https://firestore.googleapis.com','https://www.eden-chat.com']);
  const summary=safeSessionSummary(profile);assert.equal(summary.expired,true);assert.equal(summary.expiresAt,new Date(past*1000).toISOString());
  assert.equal(JSON.stringify(summary).includes(teaToken({exp:past})),false);
  for(const value of ['Bearer not-a-token','',undefined,null,'Bearer '+teaToken()])assert.equal(tokenExpiry(value),null);
});

test('renewal endpoints are fixed by kind and reject anything the page chooses',async()=>{
  assert.throws(()=>renewalRecord('teapot',{kind:'supabase',refreshToken:'x'.repeat(40)}),/UNAPPROVED_RENEWAL_KIND/);
  assert.throws(()=>renewalRecord('crack',{kind:'firebase',refreshToken:'x'.repeat(40),apiKey:'A'.repeat(39)}),/UNAPPROVED_RENEWAL_KIND/);
  assert.throws(()=>renewalRecord('teapot',{kind:'firebase',refreshToken:'short'}),/UNAPPROVED_RENEWAL_TOKEN/);
  assert.throws(()=>renewalRecord('teapot',{kind:'firebase',refreshToken:'x'.repeat(40),apiKey:'has spaces and/slashes'}),/UNAPPROVED_RENEWAL_KEY/);
  const record=renewalRecord('teapot',{kind:'firebase',refreshToken:'x'.repeat(40),apiKey:'A'.repeat(39)});
  assert.equal(record.kind,'firebase');assert.equal(record.apiKey,'A'.repeat(39));
});
test('a refresh token is exchanged at its own endpoint and the rotated one is kept',async()=>{
  const fresh='Bearer '+teaToken({exp:Math.floor(Date.now()/1000)+3600});const seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,init});
    if(url.startsWith('https://securetoken.googleapis.com/v1/token?key='))return new Response(JSON.stringify({id_token:fresh.slice(7),refresh_token:'rotated-firebase-token-value'}),{status:200,headers:{'Content-Type':'application/json'}});
    if(url==='https://jhbfalszdxacwjnrrvms.supabase.co/auth/v1/token?grant_type=refresh_token')return new Response(JSON.stringify({access_token:'supabase-fresh-access',refresh_token:'rotated-supabase-token'}),{status:200,headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify({error_code:'refresh_token_not_found'}),{status:400,headers:{'Content-Type':'application/json'}})};
  const teapot=await renewSession({platform:'teapot',profile:{renewal:{kind:'firebase',apiKey:'A'.repeat(39),refreshToken:'firebase-refresh-secret-value'}},fetchImpl});
  assert.equal(teapot.authorization,fresh);assert.deepEqual(teapot.origins,['https://firestore.googleapis.com']);
  assert.equal(teapot.renewal.refreshToken,'rotated-firebase-token-value');
  assert.equal(seen[0].init.method,'POST');assert.equal(seen[0].init.credentials,'omit');
  const eden=await renewSession({platform:'eden',profile:{headersByOrigin:{'https://jhbfalszdxacwjnrrvms.supabase.co':{apikey:'anon-key'}},renewal:{kind:'supabase',refreshToken:'supabase-refresh-secret'}},fetchImpl});
  assert.equal(eden.authorization,'Bearer supabase-fresh-access');assert.equal(eden.renewal.refreshToken,'rotated-supabase-token');
  // A renewal without the anon key must fail loudly instead of sending a bare token.
  await assert.rejects(renewSession({platform:'eden',profile:{renewal:{kind:'supabase',refreshToken:'supabase-refresh-secret'}},fetchImpl}),/RENEWAL_APIKEY_MISSING/);
  // A rejected renewal reports the server's own code, and never the token.
  const failure=await renewSession({platform:'teapot',profile:{renewal:{kind:'firebase',apiKey:'B'.repeat(39),refreshToken:'revoked-token-value-here'}},fetchImpl:async()=>new Response(JSON.stringify({error:{message:'TOKEN_EXPIRED'}}),{status:400,headers:{'Content-Type':'application/json'}})}).catch(e=>e);
  assert.ok(failure instanceof RenewalFailed);assert.equal(failure.trace.status,400);
  assert.equal(failure.message.includes('revoked-token-value-here'),false);
  // Only a renewable origin drives the pre-round refresh clock.
  const exp=Math.floor(Date.now()/1000)-1;
  assert.equal(renewableExpiry({renewal:{kind:'firebase'},headersByOrigin:{'https://firestore.googleapis.com':{authorization:'Bearer '+teaToken({exp})}}}),new Date(exp*1000).toISOString());
  // An unrenewable leg's clock must never trigger a renewal for the account.
  assert.equal(renewableExpiry({renewal:{kind:'firebase'},headersByOrigin:{'https://www.eden-chat.com':{authorization:'Bearer '+teaToken({exp})}}}),null);
  assert.equal(renewableExpiry({headersByOrigin:{}}),null);
});
test('a server that answers an expired bearer with 5xx is still renewable, but not a logout',async()=>{
  const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  assert.equal(await renewable(json(401,{})),true);
  assert.equal(await renewable(json(403,{})),true);
  // The exact code rplay returns for an expired token, observed 2026-09-22.
  assert.equal(await renewable(json(500,{code:'AUTH_TOKEN_INVALID'})),true);
  assert.equal(await renewable(json(500,{code:'INTERNAL'})),false);
  assert.equal(await renewable(json(500,{message:'SESSION_INVALID'})),false);
  assert.equal(await renewable(json(502,{})),false);
  assert.equal(await renewable(json(404,{code:'AUTH_TOKEN_INVALID'})),false);
  // Renewable is about retrying, never about reporting the account as logged out.
  const failure=await readError('rplay',json(500,{code:'AUTH_TOKEN_INVALID'}),'https://api.rplay.live/account/getuser?userid=private','getuser:p1');
  assert.equal(failure instanceof SessionExpired,false);
  assert.match(failure.message,/HTTP_500/);assert.match(failure.message,/AUTH_TOKEN_INVALID/);
  assert.equal(failure.message.includes('private'),false);
});

test('rplay and crack renew through their own published flows',async()=>{
  // rplay already sends its refresh token as a request header on every read.
  const captured=profileUpdate('rplay',{origin:'https://api.rplay.live',url:'https://api.rplay.live/account/getuser?requestorOid=abc123def456abc123def456&lang=ko',headers:{Authorization:'raw-access-token-value','refresh-token':'rplay-refresh-token-value','platform-type':'Desktop'}});
  assert.equal(captured.renewal.kind,'rplay');assert.equal(captured.renewal.refreshToken,'rplay-refresh-token-value');
  const seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,init:{...init,body:String(init.body)}});
    if(url==='https://api.rplay.live/rplay/account/refresh-token')return new Response(JSON.stringify({accessToken:'new-rplay-access',refreshToken:'rotated-rplay-refresh'}),{status:200});
    if(url==='https://crack-api.wrtn.ai/auth/v2/token/refresh')return new Response(JSON.stringify({access_token:'Bearer new-crack-access',refresh_token:'rotated-crack-refresh'}),{status:200});
    return new Response('{}',{status:404})};
  const rplay=await renewSession({platform:'rplay',profile:captured,fetchImpl});
  // rplay's stored header carries no Bearer prefix, so the renewed one must not invent it.
  assert.equal(rplay.authorization,'new-rplay-access');
  assert.equal(rplay.renewal.refreshToken,'rotated-rplay-refresh');
  assert.equal(seen[0].init.headers['refresh-token'],'rplay-refresh-token-value');
  assert.equal(seen[0].init.headers['platform-type'],'Desktop');
  assert.deepEqual(JSON.parse(seen[0].init.body),{requestorOid:'abc123def456abc123def456'});
  // Without the account id on the captured route there is nothing safe to send.
  await assert.rejects(renewSession({platform:'rplay',profile:{routes:{},renewal:captured.renewal},fetchImpl}),/RENEWAL_ACCOUNT_MISSING/);
  // crack answers with a prefixed token; the stored header keeps exactly one prefix.
  const crack=await renewSession({platform:'crack',profile:{headersByOrigin:{'https://crack-api.wrtn.ai':{authorization:'Bearer old-crack-access'}},renewal:{kind:'crack',refreshToken:'crack-refresh-token-value'}},fetchImpl});
  assert.equal(crack.authorization,'Bearer new-crack-access');
  assert.equal(crack.renewal.refreshToken,'rotated-crack-refresh');
  assert.deepEqual(crack.origins,['https://crack-api.wrtn.ai']);
  assert.equal(seen[1].init.headers.Refresh,'crack-refresh-token-value');
  assert.deepEqual(JSON.parse(seen[1].init.body),{refreshToken:'crack-refresh-token-value'});
  // A kind still cannot be borrowed by another account.
  assert.throws(()=>renewalRecord('crack',{kind:'rplay',refreshToken:'x'.repeat(40)}),/UNAPPROVED_RENEWAL_KIND/);
  assert.throws(()=>renewalRecord('eden',{kind:'crack',refreshToken:'x'.repeat(40)}),/UNAPPROVED_RENEWAL_KIND/);
});

test('a Supabase session cookie yields a refresh token, chunked and base64 encoded',async()=>{
  const source=await readFile(new URL('../src/main/notifications/core/api/capture.js',import.meta.url),'utf8');
  // Eden's own client sets cookieEncoding base64url, so the value carries - and _.
  const session={access_token:'a.b.c',refresh_token:'test12abCD34',user:{name:'테스트 작품 ?~'}};
  const encoded='base64-'+Buffer.from(JSON.stringify(session),'utf8').toString('base64url');
  assert.match(encoded,/[-_]/,'the fixture must exercise base64url characters');
  const run=(hostname,cookie,storage={})=>{
    const sent=[],listeners={};
    const location={hostname,origin:'https://'+hostname,href:'https://'+hostname+'/'};
    class XHR{open(){}setRequestHeader(){}send(){}}
    const window={fetch:async()=>new Response('{}'),postMessage:message=>sent.push(message),addEventListener:(type,fn)=>{listeners[type]=fn}};
    const keys=Object.keys(storage),localStorage={length:keys.length,key:i=>keys[i],getItem:key=>storage[key]};
    vm.runInNewContext(source,{window,location,document:{cookie},localStorage,URL,URLSearchParams,Headers,Request,TextDecoder,atob,XMLHttpRequest:XHR,setTimeout:()=>0});
    listeners.message({source:window,origin:location.origin,data:{source:'moa-api-start'}});
    return sent.map(x=>x.profile?.renewal).filter(Boolean);
  };
  const split=[encoded.slice(0,24),encoded.slice(24)];
  const eden=run('www.eden-chat.com',`sb-jhbfalszdxacwjnrrvms-auth-token.0=${split[0]}; sb-jhbfalszdxacwjnrrvms-auth-token.1=${split[1]}; unrelated=ignored`);
  assert.deepEqual(eden.map(x=>[x.kind,x.refreshToken]),[['supabase',session.refresh_token]]);
  assert.deepEqual(run('www.eden-chat.com','',{'sb-test-auth-token':JSON.stringify(session)}).map(x=>x.refreshToken),[session.refresh_token]);
  for(const token of ['', ' ', 'line\nbreak', 'x'.repeat(8193)]){
    const encodedInvalid=encodeURIComponent(JSON.stringify({refresh_token:token}));
    assert.deepEqual(run('www.eden-chat.com','sb-test-auth-token='+encodedInvalid),[]);
    assert.deepEqual(run('www.eden-chat.com','',{'sb-test-auth-token':JSON.stringify({refresh_token:token})}),[]);
  }
  const whole=run('www.eden-chat.com','sb-jhbfalszdxacwjnrrvms-auth-token='+encodeURIComponent(JSON.stringify({refresh_token:'plain-json-refresh-token'})));
  assert.deepEqual(whole.map(x=>x.refreshToken),['plain-json-refresh-token']);
  // Standard base64 with padding must keep working alongside base64url.
  const padded='base64-'+Buffer.from(JSON.stringify({refresh_token:'padded-base64-refresh-token'}),'utf8').toString('base64');
  assert.match(padded,/=$/,'the fixture must exercise base64 padding');
  assert.deepEqual(run('www.eden-chat.com','sb-jhbfalszdxacwjnrrvms-auth-token='+padded).map(x=>x.refreshToken),['padded-base64-refresh-token']);
  assert.deepEqual(run('crack.wrtn.ai','refresh_token=crack-cookie-refresh-token').map(x=>[x.kind,x.refreshToken]),[['crack','crack-cookie-refresh-token']]);
  // No session cookie at all is a quiet miss, never a capture failure.
  assert.deepEqual(run('www.eden-chat.com','theme=dark'),[]);
  assert.deepEqual(run('genit.ai','refresh_token=must-not-be-read'),[]);
});

test('Elyn renews through its own session endpoint from its refresh cookie',async()=>{
  const origin='https://api.seoul.elyn.ai',refreshToken='elynRefresh1',rotated='elynRotated2',seen=[];
  const profile=profileUpdate('elyn',{origin,headers:{authorization:'Bearer old-elyn-access'},renewal:{kind:'elyn',refreshToken}});
  assert.equal(safeSessionSummary(profile).canRenew,true);
  const result=await renewSession({platform:'elyn',profile,fetchImpl:async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({session:{access_token:'new-elyn-access',refresh_token:rotated},user:{id:'u'}}),{status:200})}});
  assert.equal(seen[0].url,origin+'/api/v1/auth/me');assert.equal(seen[0].init.method,'POST');assert.equal(seen[0].init.credentials,'omit');
  assert.deepEqual(JSON.parse(seen[0].init.body),{refresh_token:refreshToken});assert.equal(seen[0].init.headers['X-Elyn-Client'],'web');
  assert.equal(result.authorization,'Bearer new-elyn-access');assert.equal(result.renewal.refreshToken,rotated);assert.deepEqual(result.origins,[origin]);
  // A reply without a session is a failed renewal, never an empty bearer.
  await assert.rejects(renewSession({platform:'elyn',profile,fetchImpl:async()=>new Response('{}',{status:200})}),/RENEWAL_NO_TOKEN/);
  assert.throws(()=>renewalRecord('eden',{kind:'elyn',refreshToken}),/UNAPPROVED_RENEWAL_KIND/);
  assert.throws(()=>renewalRecord('elyn',{kind:'elyn',refreshToken:'line\nbreak'}),/UNAPPROVED_RENEWAL_TOKEN/);
  const source=await readFile(new URL('../src/main/notifications/core/api/capture.js',import.meta.url),'utf8'),sent=[],listeners={};
  const location={hostname:'elyn.ai',origin:'https://elyn.ai',href:'https://elyn.ai/'};
  class XHR{open(){}setRequestHeader(){}send(){}}
  const window={fetch:async()=>new Response('{}'),postMessage:message=>sent.push(message),addEventListener:(type,fn)=>{listeners[type]=fn}};
  vm.runInNewContext(source,{window,location,document:{cookie:'elyn-access-token=a.b.c; elyn-refresh-token=elyn-cookie-refresh; locale=ko'},localStorage:{length:0,key:()=>null,getItem:()=>null},URL,URLSearchParams,Headers,Request,TextDecoder,atob,XMLHttpRequest:XHR,setTimeout:()=>0});
  listeners.message({source:window,origin:location.origin,data:{source:'moa-api-start'}});
  assert.deepEqual(sent.map(x=>x.profile?.renewal).filter(Boolean).map(x=>[x.kind,x.refreshToken]),[['elyn','elyn-cookie-refresh']]);
});

test('12-character Supabase renewal survives capture storage exchange and rotation',async()=>{
  const origin='https://jhbfalszdxacwjnrrvms.supabase.co',refreshToken='test12abCD34',rotated='next12efGH56';
  const profile=profileUpdate('eden',{origin,headers:{apikey:'test-anon-key'},renewal:{kind:'supabase',refreshToken}});
  assert.equal(safeSessionSummary(profile).canRenew,true);
  const result=await renewSession({platform:'eden',profile,fetchImpl:async(url,init)=>{
    assert.equal(url,origin+'/auth/v1/token?grant_type=refresh_token');
    assert.equal(JSON.parse(init.body).refresh_token,refreshToken);
    return new Response(JSON.stringify({access_token:'new-test-access',refresh_token:rotated}),{status:200});
  }});
  assert.equal(renewalRecord('eden',result.renewal).refreshToken,rotated);
  for(const token of [null,12,'',' ','line\nbreak','x'.repeat(8193)])
    assert.throws(()=>renewalRecord('eden',{kind:'supabase',refreshToken:token}),/UNAPPROVED_RENEWAL_TOKEN/);
  for(const [platform,kind] of [['teapot','firebase'],['crack','crack'],['rplay','rplay']])
    assert.throws(()=>renewalRecord(platform,{kind,refreshToken}),/UNAPPROVED_RENEWAL_TOKEN/);
});

test('platforms whose response carries no link get their work page built from the id',()=>{
  const character='4f745fd3-ed32-455d-955b-f9aa31794000';
  const batch=normalize('genit',{results:[{id:'n1',notification_type:'creator_character_comment',payload:{character_id:character,character_name:'작품',comment_snippet:'댓글'}}]});
  assert.equal(batch.items[0].url,`https://genit.ai/ko/contents/${character}`);
  assert.equal(batch.items[0].work.url,batch.items[0].url);
  assert.equal(workLink('elyn',character),`https://elyn.ai/characters/${character}`);
  assert.equal(workLink('neko','char_1788872106350_cpvotv0'),'https://www.nekochat.xyz/character/char_1788872106350_cpvotv0');
  // An id that does not match its platform's shape must build nothing, never a guess.
  for(const [platform,id] of [['genit','not-a-uuid'],['elyn','char_1_a'],['neko',character],['neko','../escape'],['crack',character],['genit',''],['genit',null]])
    assert.equal(workLink(platform,id),null,`${platform}/${id}`);
});
