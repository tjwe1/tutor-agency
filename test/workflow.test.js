import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('accounts, permissions, availability, booking conflicts, cancellation and logout',async()=>{
const dir=mkdtempSync(join(tmpdir(),'tutor-test-'));const proc=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3107',DB_PATH:join(dir,'test.sqlite')}});
try{
await new Promise((resolve,reject)=>{proc.stdout.on('data',d=>{if(String(d).includes('listening'))resolve()});proc.on('exit',c=>reject(Error('Server exited '+c)));setTimeout(()=>reject(Error('Server startup timed out')),10000).unref()});
async function call(path,body,cookie){const r=await fetch('http://127.0.0.1:3107/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
let r=await call('register',{name:'Tutor One',email:'tutor@example.com',password:'secure-test-password',role:'tutor'});assert.equal(r.status,200);const tutor=r.cookie;
r=await call('register',{name:'Student One',email:'student@example.com',password:'secure-test-password',role:'student'});assert.equal(r.status,200);const student=r.cookie;
assert.equal((await call('profile',{subject:'Math',bio:'Patient math lessons',rate:35},student)).status,403);
assert.equal((await call('profile',{subject:'Math',bio:'Patient math lessons',rate:35},tutor)).status,200);
assert.equal((await call('slots',{starts:new Date(Date.now()+86400000).toISOString()},tutor)).status,200);
const tutors=(await call('tutors')).body;assert.equal(tutors[0].subject,'Math');const slot=(await call('slots?tutor='+tutors[0].id)).body[0];
assert.equal((await call('bookings',{slot:slot.id})).status,401);
assert.equal((await call('bookings',{slot:slot.id},tutor)).status,403);
assert.equal((await call('bookings',{slot:slot.id},student)).status,200);
assert.equal((await call('bookings',{slot:slot.id},student)).status,400);
const booking=(await call('bookings',null,student)).body[0];assert.equal(booking.tutor,'Tutor One');assert.equal((await call('bookings',null,tutor)).body.length,1);
assert.equal((await call('slots?tutor='+tutors[0].id)).body.length,0);
assert.equal((await call('cancel',{id:booking.id},student)).status,200);
assert.equal((await call('slots?tutor='+tutors[0].id)).body.length,1);
assert.equal((await call('logout',{},student)).status,200);assert.equal((await call('me',null,student)).body.user,null);
assert.equal((await call('login',{email:'student@example.com',password:'wrong'})).status,401);
assert.equal((await call('login',{email:'student@example.com',password:'secure-test-password'})).status,200);
const page=await fetch('http://127.0.0.1:3107');assert.equal(page.status,200);assert.match(await page.text(),/Tutor Agency/);
}finally{proc.kill();await new Promise(r=>proc.once('exit',r));rmSync(dir,{recursive:true,force:true})}
});
