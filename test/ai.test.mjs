import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAiRouter, createAiService } from '../ai.mjs';

test('local AI checks the selected model, uses structured output, and caches identical news',async()=>{
  const db=new DatabaseSync(':memory:');let chats=0,request;
  const fetcher=async(url,options={})=>{
    if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:8b'}]});
    chats++;request=JSON.parse(options.body);
    return Response.json({message:{content:JSON.stringify({title:'ภาพรวม Apple',summary:'หัวข้อข่าวกล่าวถึงผลิตภัณฑ์ใหม่ แต่ยังไม่มีข้อมูลผลกระทบทางการเงิน',facts:['บริษัทเผยแพร่หัวข้อเกี่ยวกับผลิตภัณฑ์ใหม่'],positiveFactors:['อาจเพิ่มความสนใจต่อผลิตภัณฑ์'],risks:['ยังไม่ทราบผลตอบรับของตลาด'],unknowns:['ไม่มีตัวเลขรายได้หรือกำไรในหัวข้อ'],confidence:'low'})}});
  };
  const ai=createAiService(db,{enabled:true,model:'qwen3:8b',fetcher});
  assert.deepEqual(await ai.status(),{enabled:true,available:true,provider:'ollama',model:'qwen3:8b',online:false,configured:true});
  const items=[{id:'one',feedId:'apple',symbol:'AAPL',source:'Apple Newsroom',title:'Apple introduces a new product',url:'https://www.apple.com/newsroom/example',publishedAt:'2026-10-19T00:00:00.000Z',stale:false}];
  const first=await ai.summarize('AAPL',items),second=await ai.summarize('AAPL',items);
  assert.equal(chats,1);assert.equal(first.cached,false);assert.equal(second.cached,true);assert.equal(first.confidence,'low');
  assert.equal(request.stream,false);assert.equal(request.think,false);assert.equal(request.format.additionalProperties,false);assert.match(request.messages[0].content,/ห้ามทำนายราคาหุ้น/);
  await assert.rejects(()=>ai.summarize('MSFT',items),error=>error.code==='no_news');
  ai.close();db.close();
});

test('local AI only accepts loopback URLs and degrades when disabled',async()=>{
  const db=new DatabaseSync(':memory:');
  assert.throws(()=>createAiService(db,{baseUrl:'http://example.com'}),/localhost/);
  const ai=createAiService(db,{enabled:false});
  assert.deepEqual(await ai.status(),{enabled:false,available:false,provider:'ollama',model:'qwen3:8b',online:false});
  await assert.rejects(()=>ai.summarize('AAPL',[{symbol:'AAPL'}]),error=>error.code==='disabled');
  db.close();
});

test('Groq online AI keeps the key in server headers and requests strict structured output',async()=>{
  const db=new DatabaseSync(':memory:');let request;
  const fetcher=async(url,options={})=>{
    assert.match(url,/^https:\/\/api\.groq\.com\/openai\/v1\//);
    assert.equal(options.headers.Authorization,'Bearer test-secret-key');
    if(url.endsWith('/models'))return Response.json({data:[{id:'qwen/qwen3.8-27b'}]});
    request=JSON.parse(options.body);
    return Response.json({choices:[{message:{content:JSON.stringify({title:'ภาพรวม Microsoft',summary:'หัวข้อกล่าวถึงบริการใหม่ แต่ข้อมูลผลกระทบยังไม่เพียงพอ',facts:['มีหัวข้อข่าวเกี่ยวกับบริการใหม่'],positiveFactors:['อาจเพิ่มการใช้งาน'],risks:['ยังไม่มีข้อมูลผลตอบรับ'],unknowns:['ไม่มีตัวเลขรายได้'],confidence:'low'})}}]});
  };
  const ai=createAiService(db,{provider:'groq',apiKey:'test-secret-key',model:'qwen/qwen3.8-27b',fetcher});
  assert.deepEqual(await ai.status(),{enabled:true,available:true,provider:'groq',model:'qwen/qwen3.8-27b',online:true,configured:true});
  const item={id:'ms-one',symbol:'MSFT',source:'Microsoft News',title:'Microsoft announces a new service',url:'https://news.microsoft.com/example',publishedAt:'2026-10-20T00:00:00.000Z',stale:false};
  const result=await ai.summarize('MSFT',[item]);
  assert.equal(result.provider,'groq');assert.equal(request.response_format.type,'json_schema');assert.equal(request.response_format.json_schema.strict,true);assert.equal(request.reasoning_effort,'none');
  assert.doesNotMatch(JSON.stringify(result),/test-secret-key/);
  const missingDb=new DatabaseSync(':memory:'),missing=createAiService(missingDb,{provider:'groq'});
  assert.equal((await missing.status()).configured,false);
  await assert.rejects(()=>missing.summarize('MSFT',[item]),error=>error.code==='not_configured');
  missing.close();missingDb.close();ai.close();db.close();
});

test('auto AI falls back from an unavailable online provider to local AI',async()=>{
  let primaryCalls=0,localCalls=0;
  const primary={status:async()=>({provider:'groq',available:true,online:true}),summarize:async()=>{primaryCalls++;throw new Error('rate limited');},close(){}};
  const fallback={status:async()=>({provider:'ollama',available:true,online:false,model:'qwen3:8b'}),summarize:async()=>{localCalls++;return {provider:'ollama',model:'qwen3:8b',summary:'local result'};},close(){}};
  const ai=createAiRouter(primary,fallback),status=await ai.status(),result=await ai.summarize('AAPL',[]);
  assert.equal(status.provider,'groq');assert.equal(status.fallbackAvailable,true);
  assert.equal(primaryCalls,1);assert.equal(localCalls,1);assert.equal(result.provider,'ollama');assert.equal(result.fallbackFrom,'groq');
});
