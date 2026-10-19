import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAiService } from '../ai.mjs';

test('local AI checks the selected model, uses structured output, and caches identical news',async()=>{
  const db=new DatabaseSync(':memory:');let chats=0,request;
  const fetcher=async(url,options={})=>{
    if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:8b'}]});
    chats++;request=JSON.parse(options.body);
    return Response.json({message:{content:JSON.stringify({title:'ภาพรวม Apple',summary:'หัวข้อข่าวกล่าวถึงผลิตภัณฑ์ใหม่ แต่ยังไม่มีข้อมูลผลกระทบทางการเงิน',facts:['บริษัทเผยแพร่หัวข้อเกี่ยวกับผลิตภัณฑ์ใหม่'],positiveFactors:['อาจเพิ่มความสนใจต่อผลิตภัณฑ์'],risks:['ยังไม่ทราบผลตอบรับของตลาด'],unknowns:['ไม่มีตัวเลขรายได้หรือกำไรในหัวข้อ'],confidence:'low'})}});
  };
  const ai=createAiService(db,{enabled:true,model:'qwen3:8b',fetcher});
  assert.deepEqual(await ai.status(),{enabled:true,available:true,model:'qwen3:8b',installed:['qwen3:8b']});
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
  assert.deepEqual(await ai.status(),{enabled:false,available:false,model:'qwen3:8b'});
  await assert.rejects(()=>ai.summarize('AAPL',[{symbol:'AAPL'}]),error=>error.code==='disabled');
  db.close();
});
