import {feeds,fetchFeed} from '../feeds.mjs';
import {openDatabase} from '../database.mjs';
import {createAiService} from '../ai.mjs';
import nodemailer from 'nodemailer';

// Network checks never print credentials or send email/Push to an unspecified recipient.
const report={checkedAt:new Date().toISOString(),news:[],database:{status:'not-configured'},ai:{status:'not-configured'},email:{status:'not-configured'},push:{status:'needs-real-device'}};
report.news=await Promise.all(feeds.map(async feed=>{
 try{const items=await fetchFeed(feed);return {source:feed.id,status:'ok',items:items.length,latest:items.map(i=>i.publishedAt).filter(Boolean).sort().at(-1)||null};}
 catch(error){return {source:feed.id,status:'failed',reason:/^HTTP \d{3}$/.test(error.message)?error.message:'Network, redirect or invalid feed'};}
}));
if(process.env.TURSO_DATABASE_URL&&process.env.TURSO_AUTH_TOKEN){
 let db;try{db=await openDatabase({databaseUrl:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});await db.get('SELECT 1');report.database={status:'ok',check:'read-only connectivity; no import performed'};}catch{report.database={status:'failed',reason:'Database connection unavailable'};}finally{await db?.close();}
}
if(process.env.GROQ_API_KEY||process.env.OLLAMA_URL){
 const db=await openDatabase({databasePath:':memory:'}),provider=process.env.GROQ_API_KEY?'groq':'ollama';let ai;
 try{
  ai=await createAiService(db,{enabled:true,provider,apiKey:process.env.GROQ_API_KEY||'',baseUrl:process.env.OLLAMA_URL,model:provider==='groq'?(process.env.GROQ_MODEL||'qwen/qwen3.8-27b'):(process.env.OLLAMA_MODEL||'qwen3:8b')});
  report.ai={status:(await ai.status()).available?'ok':'failed',check:'provider connectivity; summary quality not evaluated'};
 }catch{report.ai={status:'failed',reason:'AI provider unavailable'};}finally{ai?.close();await db.close();}
}
if(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&process.env.SMTP_FROM){
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000});
 try{await transport.verify();report.email={status:'ok',check:'SMTP authentication; inbox delivery not confirmed'};}catch{report.email={status:'failed',reason:'SMTP connection/authentication unavailable'};}finally{transport.close();}
}
report.push.configured=!!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);
report.connectivityReady=report.news.every(source=>source.status==='ok')&&['database','ai','email'].every(key=>report[key].status==='ok')&&report.push.configured;
report.ready=false; // A CLI connectivity check cannot verify inbox or handset delivery.
console.log(JSON.stringify(report,null,2));
if(!report.ready)process.exitCode=2;
