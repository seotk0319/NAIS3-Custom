// Consumer-independent notification contract. No DOM, credentials or storage.
export const PLATFORMS=['eden','babe','luna','elyn','neko','teapot','crack','rplay','genit'];
const text=v=>typeof v==='string'?v:typeof v==='number'?String(v):'';
const pick=(o,keys)=>keys.map(k=>o?.[k]).find(v=>v!==undefined&&v!==null);
export function instant(value){if(value==null||value==='')return null;if(typeof value==='object'&&typeof value.seconds==='number')value=value.seconds*1000;const d=new Date(value);return Number.isFinite(+d)?d.toISOString():null}
export function https(value){if(!value)return null;try{const u=new URL(value);return u.protocol==='https:'?u.href:null}catch{return null}}
const types={
  eden:{like:'like',comment:'comment',reply:'reply',follow:'follow',guestbook:'comment',guestbook_reply:'reply',guestbook_like:'like',post_comment:'comment',post_comment_like:'like',post_like:'like'},
  babe:{characterComment:'comment',characterDonationComment:'comment',characterReplies:'reply',commentLikeV2:'like',characterLike:'like',follow:'follow'},
  neko:{follow:'follow',character_like:'like',comment:'comment',character_comment:'comment',comment_reply:'reply'},
  genit:{creator_character_comment:'comment',creator_character_comment_reply:'reply',comment_reply:'reply',comment_liked:'like',creator_character_liked:'like',creator_character_like:'like',character_like:'like',creator_follow:'follow',user_follow:'follow',new_follower:'follow',customer_inquiry_answered:'admin',inquiry_notice:'admin'},
  rplay:{storychatsCommentByUser:'comment'},
  teapot:{'관리자':'admin','댓글':'comment','팔로우':'follow','좋아요':'like','업데이트':'admin','이벤트':'admin','서비스공지':'admin'},
};
export function classify(platform,raw){
  const type=text(platform==='teapot'&&raw.tag||pick(raw,['notification_type','event_type','type','category','kind','noti_type']));
  if(types[platform]?.[type])return {event:platform==='rplay'&&raw.isReply===true?'reply':types[platform][type],type,evidence:'source-type'};
  if(platform==='elyn'){
    if(type==='FOLLOWING')return {event:'follow',type,evidence:'source-type'};
    if(raw.reference_type==='COMMENTS')return {event:'comment',type,evidence:'reference-type'};
  }
  if(platform==='eden'&&/^admin_/.test(type))return {event:'admin',type,evidence:'source-type'};
  // Source-supplied category is a field, not a word found inside user comment text.
  if(platform==='genit'){
    const byCategory={comments:'comment',likes:'like',follows:'follow',announcements:'admin',notices:'admin'};
    if(byCategory[raw.category])return {event:byCategory[raw.category],type,evidence:'source-category'};
  }
  if(platform==='crack'&&/^(?:내 스토리에 댓글이 달렸어요|내 피드에 댓글이 달렸어요)[.!]?$/.test(raw.push?.title||''))return {event:'comment',type,evidence:'source-template'};
  if(platform==='crack'&&/^내 댓글에 대댓글이 달렸어요[.!]?$/.test(raw.push?.title||''))return {event:'reply',type,evidence:'source-template'};
  if(platform==='crack'&&/^(?:누군가 당신|누군가가 .+)의 팬이 되었어요!$/.test(raw.push?.title||''))return {event:'follow',type,evidence:'source-template'};
  return {event:'other',type,evidence:'unmapped'};
}
export function notification(platform,raw,{channel='personal',sourceId,sourceType,classification}={}){
  if(!PLATFORMS.includes(platform))throw Error('Unknown platform');
  const id=text(sourceId??pick(raw,['notificationId','id','_id','idx','notification_id']));
  if(!id)return {item:null,issue:{code:'missing-id',fields:Object.keys(raw||{}).sort()}};
  const payload=raw.payload||raw.data||{},classificationResult=classification||classify(platform,raw);
  let title=text(pick(raw,['title','subject','noti_title'])||raw.push?.title),body=text(pick(raw,['body','message','content','description','noti_msg'])||raw.push?.body);
  const actor={id:text(raw.actor?.id||payload.actorId||raw.actorOid)||null,name:text(raw.actor?.nickname||payload.actorName||raw.actorNickname)||null};
  const work={id:text(payload.character_id||payload.characterId||raw.contentOid)||null,title:text(payload.character_name||payload.characterName)||null,url:null};
  let commentId=text(payload.comment_id||raw.commentOid)||null;
  if(platform==='teapot'){
    commentId=text(raw.comment_id)||commentId;
    actor.id=text(raw.by_uid||raw.creator_admin_id)||actor.id;
    actor.name=text(raw.by_name||raw.creator_admin_name)||actor.name;
    work.id=text(raw.character_id)||work.id;
    if(typeof raw.link==='string'&&raw.link.trim()){try{const u=new URL(raw.link.trim(),'https://teapotchat.com/');if(u.protocol==='https:')raw={...raw,url:u.href}}catch{}}
    if(raw.url){try{const u=new URL(raw.url),match=u.origin==='https://teapotchat.com'&&u.pathname.match(/^\/character\/([^/]+)$/);if(match){work.id=work.id||decodeURIComponent(match[1]);work.url=u.origin+u.pathname;commentId=commentId||u.searchParams.get('comment_id');}}catch{}}
    if(channel==='global'&&!raw.url)raw={...raw,url:'https://teapotchat.com/notifications/notice/'+encodeURIComponent(id.split('/').pop())};
  }
  if(platform==='babe'){
    actor.name=text(payload.nickname)||actor.name;
    actor.id=text(payload.creatorId)||actor.id;
    const redirect=typeof raw.redirectUrl==='string'?raw.redirectUrl:'';
    if(redirect){try{const u=new URL(redirect,'https://babechat.ai/');if(u.origin==='https://babechat.ai'&&/^\/(?:character\/u\/[^/]+\/profile|creator\/[^/]+)$/.test(u.pathname)){raw={...raw,url:u.href};if(u.pathname.startsWith('/character/'))work.url=u.href}}catch{}}
  }
  if(platform==='eden'&&raw.metadata){
    const m=raw.metadata;actor.id=text(m.actor_id)||null;actor.name=text(m.actor_nickname)||null;
    work.id=text(m.work_id)||null;work.title=text(m.work_title)||null;
    work.url=work.id?`https://www.eden-chat.com/works/${encodeURIComponent(work.id)}`:null;
    if(raw.source_table==='work_comments')commentId=text(raw.source_id)||null;
    if(typeof m.content_preview==='string')body=m.content_preview;
  }
  if(platform==='crack'){
    const link=https(raw.webLink);if(link){const u=new URL(link),match=u.origin==='https://crack.wrtn.ai'&&u.pathname.match(/^\/detail\/([a-f0-9]{24})$/);if(match){work.id=match[1];work.url=u.origin+u.pathname;}}
    work.title=title.match(/^누군가가 (.+)의 팬이 되었어요!$/)?.[1]||null;
  }
  if(platform==='elyn'){
    const parts=body.split('|');
    if(raw.event_type==='FOLLOWING'){actor.name=parts[0]||null;title=`${actor.name||'작성자 미확인'}님의 팔로우`;body='';}
    else if(raw.reference_type==='COMMENTS'&&parts.length>=5){actor.name=parts[0]||null;commentId=parts[1]||null;work.id=parts[2]||null;work.title=parts[3]||null;body=parts.slice(4).join('|');title=work.title?`「${work.title}」 댓글`:'댓글';}
  }
  if(platform==='genit'){body=text(payload.comment_snippet)||body;title=title||(work.title?`「${work.title}」 ${classificationResult.event}`:actor.name?`${actor.name} · ${classificationResult.event}`:'');}
  if(platform==='neko')title=title||(work.title?`「${work.title}」 ${classificationResult.event}`:actor.name?`${actor.name} · ${classificationResult.event}`:'');
  if(platform==='rplay'&&channel==='personal'){work.title=text(raw.remark)||null;body=text(raw.commentText);title=work.title?`「${work.title}」 ${raw.isReply?'답글':'댓글'}`:'스토리챗 알림';work.url=work.id?`https://rplay.live/story/${encodeURIComponent(work.id)}`:null;}
  let sourceRead=typeof raw.isRead==='boolean'?raw.isRead:typeof raw.is_read==='boolean'?raw.is_read:null;
  const at=instant(pick(raw,['created_at','createdAt','created','time_created','noti_date','date']));
  if(!work.url)work.url=workLink(platform,work.id);
  const link=https(pick(raw,['webLink','link_url','linkUrl','url','noti_url']))||work.url;
  const type=sourceType??(platform==='teapot'&&text(raw.tag)||classificationResult.type);
  const warnings=[];if(classificationResult.evidence==='unmapped')warnings.push('unmapped-type');if(!title&&!body)warnings.push('empty-content');if(!at)warnings.push('unknown-time');
  // Only these notification records are retained, never session or account responses.
  let sourceData;
  if(platform==='babe'||platform==='teapot'){const json=JSON.stringify(raw);if(json.length<=64000)sourceData=JSON.parse(json);else warnings.push('source-data-too-large');}
  return {item:{schemaVersion:1,id:`${platform}:${channel}:${id}`,platform,sourceId:id,channel,event:classificationResult.event,kind:classificationResult.event==='reply'?'comment':classificationResult.event,sourceType:type,title:title||`알림${type?` (${type})`:''}`,body,actor,author:actor.name||'',work,commentId,at,readAt:instant(raw.read_at),unread:sourceRead===null?null:!sourceRead,url:link,stableId:true,classification:{evidence:classificationResult.evidence,warnings},provenance:'알림 API 직접 조회',...(sourceData?{sourceData}:{})},issue:null};
}
export function list(body){if(Array.isArray(body))return body;for(const key of ['notifications','alarms','results','items','data','list','content']){if(Array.isArray(body?.[key]))return body[key];if(body?.[key]&&typeof body[key]==='object'){const found=list(body[key]);if(found)return found}}return null}
export function normalize(platform,body,options={}){
  const rows=list(body);if(!rows)throw Error('UNRECOGNIZED_RESPONSE');
  const items=[],issues=[];for(const raw of rows){const result=notification(platform,raw,options);if(result.item)items.push(result.item);if(result.issue)issues.push(result.issue)}
  return {items,issues,received:rows.length,unmapped:items.filter(i=>i.classification.evidence==='unmapped').length};
}
// Reapply proven source-type mappings to saved notifications without another API call.
// Fields and unknown classifications remain intact; never infer from comment body text.
// The work page of a platform whose own response carries no link. Each shape was read
// from that site's own public pages on 2026-09-22, and an id that does not match its
// platform's shape builds nothing rather than a guessed address.
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const workPages={
  neko:id=>/^char_\d+_[a-z0-9]+$/i.test(id)?`https://www.nekochat.xyz/character/${id}`:null,
  elyn:id=>uuid(id)?`https://elyn.ai/characters/${id}`:null,
  genit:id=>uuid(id)?`https://genit.ai/ko/contents/${id}`:null
};
export function workLink(platform,id){const build=workPages[platform];return typeof id==='string'&&id&&build?build(id):null}
export function refineNotification(source){
  if(source?.schemaVersion!==1)return source;
  // Rows stored before their platform had a work page still carry the id to build one.
  const rebuilt=source.url?null:workLink(source.platform,source.work?.id);
  const item=rebuilt?{...source,url:rebuilt,work:{...source.work,url:source.work?.url||rebuilt}}:source;
  if(item.sourceData&&(item.platform==='babe'||item.platform==='teapot')){
    const classification=item.platform==='teapot'&&item.channel==='global'?{event:'admin',type:'public-notice',evidence:'source-collection'}:undefined;
    const fresh=notification(item.platform,item.sourceData,{sourceId:item.sourceId,channel:item.channel,classification}).item;
    return fresh?{...item,...fresh}:item;
  }
  const result=classify(item.platform,{type:item.sourceType,...(item.platform==='crack'?{push:{title:item.title}}:{})});
  if(result.evidence==='unmapped'||item.event==='reply'&&result.event==='comment')return item;
  return {...item,event:result.event,kind:result.event==='reply'?'comment':result.event,classification:{...item.classification,evidence:result.evidence,warnings:(item.classification?.warnings||[]).filter(x=>x!=='unmapped-type')}};
}
export function refineNotifications(items){
  const rows=items.map(refineNotification),publicNotices=new Map(),receipts=new Set();
  for(const n of rows)if(n.platform==='teapot'&&n.channel==='global')publicNotices.set(n.sourceId.split('/').pop(),n);
  for(const n of rows){
    if(n.platform!=='teapot'||n.channel!=='personal'||!['업데이트','이벤트','서비스공지'].includes(n.sourceType))continue;
    const original=publicNotices.get(n.sourceId.split('/').pop());
    if(original&&original.sourceType===n.sourceType){
      if(n.unread!==null){original.unread=n.unread;original.readAt=n.readAt;original.readReceiptId=n.sourceId;}
      receipts.add(n.id);
    }
  }
  return rows.filter(n=>!receipts.has(n.id)&&!(n.platform==='teapot'&&n.sourceData?.is_deleted===true));
}
export function firestoreValue(v){if(!v||typeof v!=='object')return null;for(const key of ['stringValue','booleanValue','timestampValue','referenceValue'])if(key in v)return v[key];if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,firestoreValue(x)]));if(v.arrayValue)return(v.arrayValue.values||[]).map(firestoreValue);return null}
