let quoteData={configured:null,items:[]},quoteBusy=false,quoteError='',quoteEpoch=0,quoteReload=false;
function resetQuotes(){quoteEpoch++;quoteBusy=false;quoteReload=false;quoteData={configured:null,items:[]};quoteError='';}
function updateQuotePanel(){const panel=document.querySelector('#quotes-panel');if(panel)panel.outerHTML=quotePanel();}
async function loadQuotes(){
  if(!currentUser)return;if(quoteBusy){quoteReload=true;return;}
  const epoch=++quoteEpoch,userId=currentUser.id,symbols=state.holdings.map(h=>h.symbol).join(',');quoteBusy=true;quoteError='';updateQuotePanel();
  try{
    const result=await api('/api/quotes');if(epoch!==quoteEpoch||currentUser?.id!==userId)return;
    if(symbols===state.holdings.map(h=>h.symbol).join(','))quoteData=result;else quoteReload=true;
  }catch(error){if(epoch!==quoteEpoch)return;quoteError=error.message;if(error.status===401)showSignedOut('login');}
  finally{if(epoch===quoteEpoch){quoteBusy=false;updateQuotePanel();if(quoteReload){quoteReload=false;loadQuotes();}}}
}
function quotePanel(){
  const holdings=state.holdings.filter(h=>stock(h.symbol).currency==='USD');
  const rows=holdings.map(h=>({h,item:quoteData.items.find(i=>i.symbol===h.symbol)}));
  const complete=rows.length>0&&rows.every(r=>r.item?.quote),value=rows.reduce((sum,r)=>sum+(r.item?.quote?.price??0)*r.h.qty,0),cost=holdings.reduce((sum,h)=>sum+h.qty*h.cost,0);
  const old=quoteError||rows.some(r=>r.item?.stale||r.item?.olderPrice);
  return `<section id="quotes-panel" class="card" style="margin-top:20px"><div class="section-title"><h2>ราคาหุ้นในพอร์ต · USD</h2><button class="btn" data-refresh-quotes ${quoteBusy?'disabled':''}>${quoteBusy?'กำลังดึงราคา…':'อัปเดตราคา'}</button></div>${quoteData.configured===false?'<div class="info-box">ยังไม่ได้ใส่ Finnhub API key · สมัครบัญชีที่ <a href="https://finnhub.io/" target="_blank" rel="noopener noreferrer">finnhub.io ↗</a> เลือกแผน Free แล้วใส่ FINNHUB_API_KEY ในไฟล์ .env บนเครื่อง และเริ่มเซิร์ฟเวอร์ใหม่ ไม่ต้องส่ง key ในแชต</div>':''}${quoteError?`<p class="form-error" role="alert">${escapeHtml(quoteError)} · หากมีราคาจะแสดงค่าครั้งก่อน</p>`:''}<div class="summary-grid"><div><span class="small-label">มูลค่าประเมินเฉพาะหุ้นสหรัฐฯ ${old?'· มีข้อมูลเก่า':''}</span><div class="summary-value">${complete?'$'+money(value):'ยังมีราคาไม่ครบ'}</div></div><div><span class="small-label">กำไร/ขาดทุนที่ยังไม่รับรู้ · ไม่รวมค่าธรรมเนียม</span><div class="summary-value">${complete?(value-cost>=0?'+':'−')+'$'+money(Math.abs(value-cost)):'—'}</div></div></div><div class="table-wrap"><table><thead><tr><th>หุ้น</th><th>ราคา USD</th><th>มูลค่าประเมิน</th><th>เวลาและสถานะ</th></tr></thead><tbody>${rows.map(({h,item})=>`<tr><td>${escapeHtml(h.symbol)}</td><td>${item?.quote?'$'+money(item.quote.price):'—'}</td><td>${item?.quote?'$'+money(h.qty*item.quote.price):'—'}</td><td>${item?.quote?`เวลาราคา ${escapeHtml(dateLabel(item.quote.quoteAt))}<small>ดึงเมื่อ ${escapeHtml(dateLabel(item.quote.fetchedAt))} · Finnhub</small>`:'ยังไม่มีราคา'}<small>${escapeHtml(item?.error||'')}${quoteError||item?.stale?' · ข้อมูลเก่าหรือยังไม่พร้อม':''}${item?.olderPrice?' · เวลาราคาเกิน 15 นาที อาจเป็นช่วงตลาดปิดหรือข้อมูลล่าช้า':''}</small></td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<p class="empty">เพิ่มหุ้นสหรัฐฯ ในพอร์ตเพื่อดึงราคา</p>'}<p class="small-note">ดึงเมื่อเข้าแอป เปิดหน้าพอร์ต หรือกดอัปเดตเท่านั้น ใช้ผลเดิมภายใน 60 วินาที ไม่ดึงราคาเป็นรอบเมื่อปิดแอป ข้อมูลอาจล่าช้าตามสิทธิ์บัญชีและเวลาซื้อขาย ไม่ใช่ราคายืนยันสำหรับส่งคำสั่งซื้อขาย</p></section>`;
}
document.addEventListener('click',event=>{if(event.target.closest('[data-refresh-quotes]')&&currentUser&&!quoteBusy)loadQuotes();});
