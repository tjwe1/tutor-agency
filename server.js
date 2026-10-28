import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
mkdirSync('data', {recursive:true});
const db=new DatabaseSync(process.env.DB_PATH || 'data/tutors.sqlite');
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('student','tutor')));
CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id),subject TEXT NOT NULL DEFAULT 'English',bio TEXT NOT NULL DEFAULT '',rate INTEGER NOT NULL DEFAULT 25);
CREATE TABLE IF NOT EXISTS slots(id INTEGER PRIMARY KEY,tutor_id INTEGER NOT NULL REFERENCES users(id),starts TEXT NOT NULL,UNIQUE(tutor_id,starts));
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY,slot_id INTEGER UNIQUE NOT NULL REFERENCES slots(id),student_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);`);
const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex')};
const verify=(p,h)=>{const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex'))};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
const limited=new Map();
const server=http.createServer(async(req,res)=>{
try{
const url=new URL(req.url,'http://localhost');
if(!url.pathname.startsWith('/api/')){const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[url.pathname];if(!file){res.writeHead(404);return res.end('Not found')};res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(readFileSync(new URL('./public/'+file,import.meta.url)))}
if(req.method!=='GET' && req.headers.origin && req.headers.origin!==`${req.socket.encrypted?'https':'http'}://${req.headers.host}`)return json(res,403,{error:'Invalid request origin'});
const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
const user=token?db.prepare('SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(token,Date.now()):null;
let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)return json(res,413,{error:'Request too large'})}try{body=JSON.parse(raw||'{}')}catch{return json(res,400,{error:'Invalid JSON'})}}
const fail=(message,status=400)=>json(res,status,{error:message});
if(url.pathname==='/api/me')return json(res,200,{user:user||null});
if(['/api/register','/api/login'].includes(url.pathname)&&req.method==='POST'){
const key=req.socket.remoteAddress;const now=Date.now();const attempts=(limited.get(key)||[]).filter(t=>now-t<60000);if(attempts.length>=15)return fail('Too many attempts. Try again in a minute.',429);attempts.push(now);limited.set(key,attempts);
const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');let account;
if(url.pathname==='/api/register'){
const name=String(body.name||'').trim();if(!name||name.length>80||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||password.length<10||password.length>200||!['student','tutor'].includes(body.role))return fail('Enter a name, valid email, role, and password of 10–200 characters.');
if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return fail('This email is already registered.');
const id=Number(db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,hash(password),body.role).lastInsertRowid);if(body.role==='tutor')db.prepare('INSERT INTO profiles(user_id) VALUES(?)').run(id);account={id};
}else{account=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(password.length>200||!account||!verify(password,account.password))return fail('Email or password is incorrect.',401)}
const session=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(session,account.id,Date.now()+7*86400000);res.setHeader('Set-Cookie',`session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV==='production'?'; Secure':''}`);return json(res,200,{ok:true});}
if(url.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token||'');res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return json(res,200,{ok:true})}
if(url.pathname==='/api/tutors'&&req.method==='GET')return json(res,200,db.prepare(`SELECT u.id,u.name,p.subject,p.bio,p.rate FROM users u JOIN profiles p ON p.user_id=u.id ORDER BY u.id DESC`).all());
if(url.pathname==='/api/slots'&&req.method==='GET')return json(res,200,db.prepare('SELECT s.* FROM slots s LEFT JOIN bookings b ON b.slot_id=s.id WHERE s.tutor_id=? AND b.id IS NULL AND s.starts>? ORDER BY s.starts').all(Number(url.searchParams.get('tutor')),new Date().toISOString()));
if(!user)return fail('Please sign in.',401);
if(url.pathname==='/api/profile'&&req.method==='POST'){if(user.role!=='tutor')return fail('Tutor account required.',403);const subject=String(body.subject||'').trim(),bio=String(body.bio||'').trim(),rate=Number(body.rate);if(!subject||subject.length>60||bio.length>2000||!Number.isInteger(rate)||rate<1||rate>500)return fail('Enter a subject, biography under 2,000 characters, and hourly rate from 1 to 500.');db.prepare('UPDATE profiles SET subject=?,bio=?,rate=? WHERE user_id=?').run(subject,bio,rate,user.id);return json(res,200,{ok:true})}
if(url.pathname==='/api/slots'&&req.method==='POST'){if(user.role!=='tutor')return fail('Tutor account required.',403);const date=new Date(body.starts);if(!Number.isFinite(date.getTime())||date<=new Date())return fail('Choose a future date.');const start=date.toISOString();if(db.prepare('SELECT id FROM slots WHERE tutor_id=? AND ABS(julianday(starts)-julianday(?))*24<0.99999').get(user.id,start))return fail('This overlaps an existing one-hour slot.');db.prepare('INSERT INTO slots(tutor_id,starts) VALUES(?,?)').run(user.id,start);return json(res,200,{ok:true})}
if(url.pathname==='/api/bookings'&&req.method==='GET')return json(res,200,db.prepare(`SELECT b.id,s.starts,t.name tutor,st.name student,p.subject,p.rate FROM bookings b JOIN slots s ON b.slot_id=s.id JOIN users t ON t.id=s.tutor_id JOIN users st ON st.id=b.student_id JOIN profiles p ON p.user_id=t.id WHERE ${user.role==='tutor'?'s.tutor_id':'b.student_id'}=? ORDER BY s.starts`).all(user.id));
if(url.pathname==='/api/bookings'&&req.method==='POST'){if(user.role!=='student')return fail('Student account required.',403);const slot=db.prepare('SELECT * FROM slots WHERE id=? AND starts>?').get(Number(body.slot),new Date().toISOString());if(!slot)return fail('This slot is no longer available.');if(db.prepare('SELECT b.id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.student_id=? AND ABS(julianday(s.starts)-julianday(?))*24<0.99999').get(user.id,slot.starts))return fail('You already have a lesson at this time.');try{db.prepare('INSERT INTO bookings(slot_id,student_id) VALUES(?,?)').run(slot.id,user.id)}catch{return fail('This slot has already been booked.',409)}return json(res,200,{ok:true})}
if(url.pathname==='/api/cancel'&&req.method==='POST'){db.prepare('DELETE FROM bookings WHERE id=? AND (student_id=? OR slot_id IN (SELECT id FROM slots WHERE tutor_id=?))').run(Number(body.id),user.id,user.id);return json(res,200,{ok:true})}
return fail('Not found',404);
}catch(e){console.error(e.message);json(res,500,{error:'Something went wrong. Please try again.'})}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`Tutor Agency listening on port ${process.env.PORT||3000}`));
