const OWNER = 'ab13a3dc-aa6d-43e4-a77e-412aca18391d';
const START = Date.parse('2026-10-24T17:00:00-04:00');
const END = Date.parse('2026-11-01T05:00:00-05:00');
const URL = process.env.SUPABASE_URL || 'https://rolkhhmrvxzjcfdialgo.supabase.co';
const PUBLIC = 'sb_publishable_ck01IpqaBsgEBQZHb5qzQA_w8qRCcUI';
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = 'wedding-photos';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function api(path, options={}, token=SECRET) {
 const r=await fetch(URL+path,{...options,headers:{apikey:token===SECRET?SECRET:PUBLIC,Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(20000)});
 if(!r.ok) {const e=new Error('Storage service request failed');e.status=r.status;throw e;} return r.status===204?null:r.json();
}
async function owner(token) {
 if(!token)return false;
 try {return (await api('/auth/v1/user',{},token)).id===OWNER;}catch{return false;}
}
function validate(b) {
 if(!b || !uuid.test(b.id||''))throw new Error('Invalid photo identifier.');
 const fields={name:100,people:300,caption:200,note:2000,frame:30,filter:30};
 for(const [k,max] of Object.entries(fields))if(typeof b[k]!=='string'||b[k].length>max)throw new Error(`Invalid ${k}.`);
 if(!b.name.trim())throw new Error('Please enter your name.');
 if(typeof b.photo!=='string'||b.photo.length>4000000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(b.photo))throw new Error('Please use a JPEG photo under 3 MB.');
 const bytes=Buffer.from(b.photo.split(',')[1],'base64');
 if(bytes.length<100||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('Invalid JPEG photo.');
 return bytes;
}
module.exports=async function(req,res) {
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const send=(s,b)=>res.status(s).json(b);
 const path=req.url.split('?')[0];const token=(req.headers.authorization||'').replace(/^Bearer /,'');
 try {
 if(path==='/api/config'&&req.method==='GET')return send(200,{url:URL,key:PUBLIC,configured:!!SECRET,open:Date.now()>=START&&Date.now()<END,start:START,end:END});
 if(!SECRET)return send(503,{error:'Photo storage is not connected yet. Please download your keepsake.'});
 if(path==='/api/upload'&&req.method==='POST') {
 if(!(Date.now()>=START&&Date.now()<END)&&!await owner(token))return send(403,{error:'Guest collection opens October 24 at 5 PM Eastern.'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(415,{error:'JSON required.'});
 let b=req.body;if(typeof b==='string')b=JSON.parse(b);
 let bytes;try{bytes=validate(b);}catch(e){return send(400,{error:e.message});}
 const existing=await api(`/rest/v1/wedding_photos?id=eq.${b.id}&select=id`);if(existing.length)return send(200,{saved:true,id:b.id});
 const photoPath=`${b.id}.jpg`;
 try{await api(`/storage/v1/object/${bucket}/${photoPath}`,{method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:bytes});}catch(e){if(![400,409].includes(e.status))throw e;const check=await api(`/rest/v1/wedding_photos?id=eq.${b.id}&select=id`);if(check.length)return send(200,{saved:true,id:b.id});return send(409,{error:'This upload is still processing. Wait a moment and retry.'});}
 try{await api('/rest/v1/wedding_photos',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({id:b.id,guest_name:b.name.trim(),other_names:b.people,caption:b.caption,note:b.note,photo_path:photoPath,edited_photo_path:photoPath,frame:b.frame,filter:b.filter})});}
 catch(e){await api(`/storage/v1/object/${bucket}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[photoPath]})}).catch(()=>{});throw e;}
 return send(200,{saved:true,id:b.id});
 }
 if(path==='/api/archive') {
 if(!await owner(token))return send(401,{error:'Please sign in with the couple’s archive account.'});
 if(req.method==='GET'){
 const offset=Math.max(0,Number(new global.URL(req.url,'https://local').searchParams.get('offset'))||0);
 const rows=await api(`/rest/v1/wedding_photos?select=*&order=created_at.desc&limit=50&offset=${offset}`,{},token);
 const photos=await Promise.all(rows.map(async p=>{const signed=await api(`/storage/v1/object/sign/${bucket}/${p.edited_photo_path||p.photo_path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})},token);return {...p,url:URL+'/storage/v1'+signed.signedURL};}));return send(200,{photos});
 }
 if(req.method==='PATCH') {const b=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!uuid.test(b?.id||'')||!['favorite','hidden'].includes(b.field)||typeof b.value!=='boolean')return send(400,{error:'Invalid update.'});await api(`/rest/v1/wedding_photos?id=eq.${b.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({[b.field]:b.value})},token);return send(200,{saved:true});}
 }
 return send(404,{error:'Not found'});
 }catch(e){console.error('Request failed',path,e.status||'internal');return send(500,{error:'Saving did not finish. Keep this screen open and try again.'});}
};
module.exports.validate=validate;
