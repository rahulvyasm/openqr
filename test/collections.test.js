import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {fixture,urlCode} from './helpers.js';
import {createApp} from '../server/app.js';
import {createBackup,restoreBackup} from '../server/backup.js';
import {createObjectStore,storageOptionsFromEnv} from '../server/object-store.js';
import {inspectMedia} from '../server/media.js';
const files=Object.fromEntries(await Promise.all(['mp3','mp4','webm'].map(async ext=>[ext,await readFile(new URL(`./fixtures/sample.${ext}`,import.meta.url))])));
const upload=async(request,bytes,name)=>{const res=await request('/api/assets',{method:'POST',raw:bytes,headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(name)}});assert.equal(res.status,201,await res.clone().text());return res.json();};
const create=async(request,type,data,extra={})=>{const res=await request('/api/codes',{method:'POST',body:urlCode({type,data,...extra})});assert.equal(res.status,201,await res.clone().text());return res.json();};
const ticket=html=>decodeURIComponent(html.match(/\?ticket=([^"&]+)/)[1]);
const picture=()=>sharp({create:{width:50,height:30,channels:3,background:'#719257'}}).png().toBuffer();

test('galleries preserve ordering, escape captions, publish only bound workspace images and protect template references',async t=>{
 const {request,setup}=await fixture(t);await setup();const first=await upload(request,await picture(),'First.png'),second=await upload(request,await picture(),'Second.png');
 const items=[{assetId:first.id,caption:'<script>bad</script>',alt:'A green square'},{assetId:second.id,caption:'Second image',alt:'Another square'}];const code=await create(request,'gallery',{title:'A little collection',items:JSON.stringify(items),allowDownload:'true'},{pageOptions:{layout:'editorial',font:'serif',corners:'square',galleryLayout:'stack'}});
 const page=await request(`/r/${code.slug}`,{authenticated:false}),html=await page.text(),token=ticket(html);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));assert.ok(html.indexOf(first.id)<html.indexOf(second.id));assert.match(html,/photo-lightbox/);assert.match(html,/photo-grid stack/);
 assert.equal((await request(`/r/${code.slug}/media/${first.id}?ticket=${token}&download=1`,{authenticated:false})).status,200);
 const updated=await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,data:{...code.data,items:JSON.stringify([...items].reverse())}}});assert.equal(updated.status,200);assert.equal((await updated.json()).shortUrl,code.shortUrl);
 assert.equal((await request(`/api/assets/${first.id}`,{method:'DELETE'})).status,409);
 const template=await request('/api/page-templates',{method:'POST',body:{name:'Our photo page',type:'gallery',data:code.data,pageOptions:code.pageOptions}});assert.equal(template.status,201);const templateId=(await template.json()).id;
 await request(`/api/codes/${code.id}`,{method:'DELETE'});assert.equal((await request(`/api/assets/${first.id}`,{method:'DELETE'})).status,409);await request(`/api/page-templates/${templateId}`,{method:'DELETE'});assert.equal((await request(`/api/assets/${first.id}`,{method:'DELETE'})).status,200);
});

test('real MP3, MP4 and WebM uploads expose inspected metadata and support seeking without adding scans',async t=>{
 const {request,setup,db}=await fixture(t);await setup();
 for(const [ext,bytes] of Object.entries(files)){const asset=await upload(request,bytes,`Sample.${ext}`),type=ext==='mp3'?'audio':'video';assert.equal(asset.kind,type);assert.ok(asset.metadata.duration>0);if(type==='video')assert.equal(asset.metadata.width,320);
  const code=await create(request,type,{title:'Press play',mediaId:asset.id,allowDownload:'true'}),html=await (await request(`/r/${code.slug}`,{authenticated:false})).text(),token=ticket(html);assert.match(html,new RegExp(`<${type} `));assert.ok(!html.includes('autoplay'));
  const path=`/r/${code.slug}/media/${asset.id}?ticket=${token}`,response=await request(path,{authenticated:false,headers:{range:'bytes=10-29'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 10-29/${bytes.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(10,30));
  const download=await request(path+'&download=1',{authenticated:false});assert.match(download.headers.get('content-disposition'),/^attachment/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM scans WHERE code_id=?').get(code.id).n,1);
  await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,active:false}});assert.equal((await request(path,{authenticated:false})).status,410);
 }
 for(const bytes of [Buffer.from('ID3not a real MP3'),Buffer.from('not a video')])assert.equal((await request('/api/assets',{method:'POST',raw:bytes,headers:{'content-type':'application/octet-stream','x-file-name':'fake.mp4'}})).status,400);
});

test('media replacements retain QR links; file kinds, downloads and missing content are enforced',async t=>{
 const {request,setup}=await fixture(t);await setup();const audio=await upload(request,files.mp3,'One.mp3'),second=await upload(request,files.mp3,'Two.mp3'),video=await upload(request,files.mp4,'Film.mp4');const code=await create(request,'audio',{title:'Our podcast',mediaId:audio.id});
 const html=await (await request(`/r/${code.slug}`)).text(),token=ticket(html);assert.ok(!html.includes('Download audio'));assert.equal((await request(`/r/${code.slug}/media/${audio.id}?ticket=${token}&download=1`,{authenticated:false})).status,403);
 const updated=await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,data:{...code.data,mediaId:second.id}}});assert.equal(updated.status,200);assert.equal((await updated.json()).shortUrl,code.shortUrl);assert.equal((await request(`/r/${code.slug}/media/${audio.id}?ticket=${token}`,{authenticated:false})).status,404);assert.equal((await request(`/api/assets/${audio.id}`,{method:'DELETE'})).status,200);
 for(const body of [urlCode({type:'audio',data:{title:'Wrong kind',mediaId:video.id}}),urlCode({type:'video',data:{title:'Missing'}}),urlCode({type:'gallery',data:{title:'No images',items:'[]'}}),urlCode({type:'gallery',data:{title:'Wrong kind',items:JSON.stringify([{assetId:second.id}])}})])assert.equal((await request('/api/codes',{method:'POST',body})).status,400);
});

test('hosted events format time zones, export calendars with stable identities, and validate event and registration fields',async t=>{
 const {request,setup}=await fixture(t);await setup();const data={title:'An evening together',description:'A little gathering',startsAt:'2027-03-15T12:00:00Z',endsAt:'2027-03-15T14:00:00Z',timeZone:'Asia/Kolkata',venue:'The Studio',address:'12 Market Street',registrationUrl:'https://example.com/register',registrationLabel:'Reserve a place'};
 const code=await create(request,'hosted-event',data),html=await (await request(`/r/${code.slug}`,{authenticated:false})).text(),token=ticket(html);assert.match(html,/Asia\/Kolkata/);assert.match(html,/5:30 PM/);assert.match(html,/Reserve a place/);assert.match(html,/Get directions/);
 const calendar=await request(`/r/${code.slug}/event.ics?ticket=${token}`,{authenticated:false});assert.equal(calendar.status,200);assert.match(calendar.headers.get('content-type'),/text\/calendar/);const text=await calendar.text();assert.match(text,/DTSTART:20270315T120000Z/);assert.ok(text.includes(`UID:${code.id}@openqr.local`));assert.match(text,/LOCATION:The Studio\\, 12 Market Street/);
 await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,data:{...data,title:'A new title',startsAt:'2027-03-15T12:30:00Z'}}});assert.ok((await (await request(`/r/${code.slug}/event.ics?ticket=${token}`)).text()).includes(`UID:${code.id}@openqr.local`));
 for(const extra of [{endsAt:data.startsAt},{timeZone:'Invalid/Timezone'},{registrationUrl:'javascript:alert(1)'},{startsAt:'not a date'}])assert.equal((await request('/api/codes',{method:'POST',body:urlCode({type:'hosted-event',data:{...data,...extra}})})).status,400);
 assert.equal((await request(`/r/${code.slug}/event.ics`,{authenticated:false})).status,403);
});

test('app pages route iOS, Android, iPad desktop-mode and fallback traffic through permanent tracked links',async t=>{
 const {request,setup,db}=await fixture(t);await setup();const data={title:'Our new app',iosUrl:'https://apps.apple.com/app/id123456',androidUrl:'https://play.google.com/store/apps/details?id=example.app',fallbackUrl:'https://example.com/app',routing:'smart'},code=await create(request,'app',data);
 for(const [ua,destination] of [['iPhone',data.iosUrl],['Android',data.androidUrl],['Mozilla Macintosh Mobile',data.iosUrl],['Windows',data.fallbackUrl]]){const response=await request(`/r/${code.slug}`,{authenticated:false,headers:{'user-agent':ua}});assert.equal(response.status,302);assert.equal(response.headers.get('location'),destination);}
 assert.equal(db.prepare('SELECT COUNT(*) n FROM scans WHERE code_id=?').get(code.id).n,4);
 await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,data:{...data,iosUrl:''}}});assert.equal((await request(`/r/${code.slug}`,{headers:{'user-agent':'iPhone'}})).headers.get('location'),data.fallbackUrl);
 await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,data:{...data,routing:'landing'}}});const html=await (await request(`/r/${code.slug}`)).text();assert.match(html,/Download on the App Store/);assert.match(html,/Get it on Google Play/);
 for(const extra of [{iosUrl:'https://evil.example/apps.apple.com'},{androidUrl:'javascript:alert(1)'},{fallbackUrl:''},{iosUrl:'',androidUrl:''}])assert.equal((await request('/api/codes',{method:'POST',body:urlCode({type:'app',data:{...data,...extra}})})).status,400);
});

test('workspace quotas and upload limits are enforced before metadata is committed',async t=>{
 const {request,setup}=await fixture(t,':memory:',{storageOptions:{quota:10000,maxUpload:20000}});await setup();await upload(request,files.mp3,'One.mp3');const before=await (await request('/api/storage')).json();assert.equal(before.usedBytes,files.mp3.length);assert.equal(before.limitBytes,10000);
 assert.equal((await request('/api/assets',{method:'POST',raw:files.mp3,headers:{'content-type':'application/octet-stream'}})).status,413);assert.equal((await (await request('/api/assets')).json()).length,1);
 assert.equal((await request('/api/assets',{method:'POST',raw:Buffer.alloc(20001),headers:{'content-type':'application/octet-stream'}})).status,413);
 assert.equal((await request('/health/live',{authenticated:false})).status,200);assert.equal((await request('/health/ready',{authenticated:false})).status,200);
 for(const config of [{WORKSPACE_STORAGE_MB:'-1'},{MAX_UPLOAD_MB:'501'},{S3_BUCKET:'private',S3_ENDPOINT:'http://public.example.com'}])assert.throws(()=>storageOptionsFromEnv(config));
});

test('page templates remain workspace-scoped and independent of later edits to their source page',async t=>{
 const {request,setup}=await fixture(t);await setup();const data={title:'Launch',iosUrl:'https://apps.apple.com/app/id123',fallbackUrl:'https://example.com'},body={name:'Our app launch',type:'app',data,pageOptions:{layout:'editorial',font:'serif',buttonStyle:'solid'}};
 assert.equal((await request('/api/page-templates',{method:'POST',body})).status,201);assert.equal((await request('/api/page-templates',{method:'POST',body})).status,409);const template=(await (await request('/api/page-templates')).json())[0];assert.equal(template.pageOptions.layout,'editorial');const code=await create(request,'app',template.data,{pageOptions:template.pageOptions});await request(`/api/codes/${code.id}`,{method:'PUT',body:{...code,data:{...data,title:'Changed'}}});assert.equal((await (await request('/api/page-templates')).json())[0].data.title,'Launch');
 await request('/api/workspaces',{method:'POST',body:{name:'Separate'}});assert.deepEqual(await (await request('/api/page-templates')).json(),[]);
});

function memoryClient(){const objects=new Map();let failure=false;return {objects,set failure(v){failure=v;},async send(command){if(failure)throw new Error('Object storage unavailable');const {Bucket,Key,Body,Range}=command.input,key=Bucket+'/'+Key,name=command.constructor.name;if(name==='PutObjectCommand'){let bytes;if(Buffer.isBuffer(Body)||Body instanceof Uint8Array)bytes=Buffer.from(Body);else{const parts=[];for await(const part of Body)parts.push(part);bytes=Buffer.concat(parts);}objects.set(key,bytes);return {};}
 if(name==='DeleteObjectCommand'){objects.delete(key);return {};}
 if(name==='HeadBucketCommand')return {};
 if(name==='GetObjectCommand'){let bytes=objects.get(key);if(!bytes)throw Object.assign(new Error('Missing'),{name:'NoSuchKey'});let contentRange;const length=bytes.length;if(Range){const [start,end]=Range.slice(6).split('-');const a=start?+start:Math.max(0,length-(+end)),b=start?(end?Math.min(+end,length-1):length-1):length-1;if(a>=length||a>b)throw Object.assign(new Error('Range'),{$metadata:{httpStatusCode:416}});bytes=bytes.subarray(a,b+1);contentRange=`bytes ${a}-${b}/${length}`;}const stream=Readable.from([bytes]);stream.transformToByteArray=async()=>bytes;return {Body:stream,ContentLength:bytes.length,ContentRange:contentRange};}throw new Error('Unexpected S3 command');}};}

test('object storage streams ranges privately, backs up remote assets, and reports outages without exposing details',async t=>{
 const client=memoryClient(),objectStore=createObjectStore({bucket:'private-test',prefix:'media/',client}),{request,setup,db,storage}=await fixture(t,':memory:',{storageOptions:{objectStore,backupBucket:'backup-test',backupPrefix:'archives/'}});await setup();const asset=await upload(request,files.mp4,'Film.mp4'),row=db.prepare('SELECT * FROM assets WHERE id=?').get(asset.id);assert.ok(client.objects.has('private-test/media/'+row.storage_key));assert.equal((await request(asset.url,{authenticated:false})).status,401);
 const response=await request(asset.url,{headers:{range:'bytes=5-14'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),files.mp4.subarray(5,15));assert.equal((await request(asset.url,{headers:{range:'bytes=999999-'}})).status,416);
 const code=await create(request,'video',{title:'A film',mediaId:asset.id});const folder=await mkdtemp(join(tmpdir(),'openqr-remote-backup-'));t.after(()=>rm(folder,{recursive:true,force:true}));const archive=await createBackup({db,storage,directory:join(folder,'backups'),publicUrl:'https://qr.example.com'});assert.ok([...client.objects.keys()].some(k=>k.startsWith('backup-test/archives/openqr-')));const restored=join(folder,'restored');await restoreBackup({archive,dataDir:restored,confirmedStopped:true});const app=createApp({dbPath:join(restored,'openqr.sqlite')});try{assert.equal(app.db.prepare('SELECT slug FROM codes WHERE id=?').get(code.id).slug,code.slug);assert.deepEqual(await readFile(app.storage.filePath(row.storage_key)),files.mp4);}finally{app.db.close();}
 client.failure=true;assert.equal((await request('/health/ready',{authenticated:false})).status,503);const failure=await request(asset.url);assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes('private-test'));client.failure=false;
 await request(`/api/codes/${code.id}`,{method:'DELETE'});await request(`/api/assets/${asset.id}`,{method:'DELETE'});assert.ok(!client.objects.has('private-test/media/'+row.storage_key));
});

test('v0.4 metadata migrates without losing media or saved page content',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'openqr-v4-upgrade-')),{request,setup,db}=await fixture(t,join(folder,'openqr.sqlite'));t.after(()=>rm(folder,{recursive:true,force:true}));await setup();const asset=await upload(request,await picture(),'Cover.png');const code=await create(request,'business',{title:'Our business',coverId:asset.id});db.exec('DROP TABLE page_templates; ALTER TABLE assets DROP COLUMN metadata; PRAGMA user_version=4;');const app=createApp({dbPath:join(folder,'openqr.sqlite')});try{assert.equal(app.db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(app.db.prepare('SELECT slug FROM codes').get().slug,code.slug);assert.deepEqual(JSON.parse(app.db.prepare('SELECT metadata FROM assets').get().metadata),{});assert.equal(app.db.prepare('SELECT COUNT(*) n FROM page_templates').get().n,0);}finally{app.db.close();}
});
