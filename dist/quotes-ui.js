let quoteData={configured:null,items:[]},quoteBusy=false,quoteError='',quoteEpoch=0,quoteReload=false;
function resetQuotes(){quoteEpoch++;quoteBusy=false;quoteReload=false;quoteData={configured:null,items:[]};quoteError='';}
function updateQuotePanel(){const panel=document.querySelector('#quotes-panel');if(panel)panel.outerHTML=quotePanel();}
async function loadQuotes(){
  if(!currentUser)return;if(quoteBusy){quoteReload=true;return;}
  const epoch=++quoteEpoch,userId=currentUser.id,symbols=state.watchlist.join(',');quoteBusy=true;quoteError='';updateQuotePanel();
  try{
    const result=await api('/api/quotes');if(epoch!==quoteEpoch||currentUser?.id!==userId)return;
    if(symbols===state.watchlist.join(','))quoteData=result;else quoteReload=true;
  }catch(error){if(epoch!==quoteEpoch)return;quoteError=error.message;if(error.status===401)showSignedOut('login');}
  finally{if(epoch===quoteEpoch){quoteBusy=false;updateQuotePanel();if(quoteReload){quoteReload=false;loadQuotes();}}}
}
function quotePanel(){
  const rows=state.watchlist.map(symbol=>({symbol,item:quoteData.items.find(i=>i.symbol===symbol)}));
  return `<section id="quotes-panel" class="card" style="margin-top:20px"><div class="section-title"><h2>ราคาของบริษัทที่ติดตาม · USD</h2><button class="btn" data-refresh-quotes ${quoteBusy?'disabled':''}>${quoteBusy?'กำลังดึงราคา…':'อัปเดตราคา'}</button></div>${quoteData.configured===false?'<div class="info-box">ยังไม่ได้ใส่ Finnhub API key · ราคานี้เป็นข้อมูลเสริม ไม่จำเป็นต่อการติดตามข่าว</div>':''}${quoteError?`<p class="form-error" role="alert">${escapeHtml(quoteError)} · หากมีราคาจะแสดงค่าครั้งก่อน</p>`:''}<div class="table-wrap"><table><thead><tr><th>บริษัท</th><th>ราคา USD</th><th>เวลาและสถานะ</th></tr></thead><tbody>${rows.map(({symbol,item})=>`<tr><td><b>${escapeHtml(symbol)}</b><small>${escapeHtml(stock(symbol).name)}</small></td><td>${item?.quote?'$'+money(item.quote.price):'—'}</td><td>${item?.quote?`เวลาราคา ${escapeHtml(dateLabel(item.quote.quoteAt))}<small>ดึงเมื่อ ${escapeHtml(dateLabel(item.quote.fetchedAt))} · Finnhub</small>`:'ยังไม่มีราคา'}<small>${escapeHtml(item?.error||'')}${quoteError||item?.stale?' · ข้อมูลเก่าหรือยังไม่พร้อม':''}${item?.olderPrice?' · อาจเป็นช่วงตลาดปิดหรือข้อมูลล่าช้า':''}</small></td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<p class="empty">เลือกบริษัทที่สนใจเพื่อดูราคาและข่าว</p>'}<p class="small-note">ไม่คำนวณมูลค่าพอร์ตหรือกำไรขาดทุน เพราะระบบไม่เก็บจำนวนหุ้นและต้นทุน</p></section>`;
}
document.addEventListener('click',event=>{if(event.target.closest('[data-refresh-quotes]')&&currentUser&&!quoteBusy)loadQuotes();});
