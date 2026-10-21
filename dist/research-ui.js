let researchCompanies=[],researchCompany=null,researchMonths=1,researchResult=null,researchError='',researchBusy='',researchEpoch=0;
function resetResearch(){researchEpoch++;researchCompanies=[];researchCompany=null;researchMonths=1;researchResult=null;researchError='';researchBusy='';}
function researchPanel(){
  const result=researchResult,summary=result?.summary;
  return `<section class="card research-panel" id="research-panel"><div class="section-title"><h2>ค้นข่าวย้อนหลังและให้ AI สรุป</h2></div><p class="small-note">พิมพ์ชื่อบริษัทหรือตัวย่อด้านบน แล้วเลือกบริษัทที่พบ · ใช้ข้อมูลข่าว Finnhub และ AI ที่ตั้งค่าไว้ในแอป</p><button class="btn" type="button" data-research-find ${researchBusy?'disabled':''}>${researchBusy==='companies'?'กำลังค้นหา…':'1. ค้นหาบริษัท'}</button>${researchCompanies.length?`<div class="research-companies" role="group" aria-label="เลือกบริษัท">${researchCompanies.map((company,index)=>`<button class="research-company ${researchCompany?.symbol===company.symbol?'selected':''}" type="button" data-research-index="${index}"><b>${escapeHtml(company.symbol)}</b> ${escapeHtml(company.name)}</button>`).join('')}</div>`:''}${researchCompany?`<div class="research-choice"><b>${escapeHtml(researchCompany.name)} (${escapeHtml(researchCompany.symbol)})</b><span>2. ต้องการดูข่าวย้อนหลังเท่าไร?</span><div class="research-months" role="group" aria-label="ช่วงข่าวย้อนหลัง">${[1,3,6].map(months=>`<button type="button" class="tab ${researchMonths===months?'active':''}" data-research-months="${months}" aria-pressed="${researchMonths===months}">${months} เดือน</button>`).join('')}</div><button class="btn primary" type="button" data-research-run ${researchBusy?'disabled':''}>${researchBusy==='news'?'กำลังค้นข่าวและสรุป…':'3. ค้นข่าวและสรุปด้วย AI'}</button></div>`:''}${researchError?`<p class="form-error" role="alert">${escapeHtml(researchError)}</p>`:''}${result?`<div class="research-results" aria-live="polite"><h3>ข่าว ${escapeHtml(result.name)} · ${result.from} ถึง ${result.to}</h3><p class="small-note">พบข่าวที่กรองว่าเกี่ยวข้อง ${result.matchedCount} รายการ · แสดง ${result.articles.length} รายการ${result.failedMonths?` · ดึงไม่สำเร็จ ${result.failedMonths} เดือน`:''}${result.truncatedMonths?` · Finnhub จำกัดผลบางเดือนที่ 250 รายการ`:''}</p>${summary?`<div class="ai-trend">${escapeHtml(summary.title)}</div><p>${escapeHtml(summary.summary)}</p>${aiList('ข้อเท็จจริงจากหัวข้อ',summary.facts)}${aiList('ปัจจัยบวกที่ควรตรวจต่อ',summary.positiveFactors)}${aiList('ความเสี่ยง',summary.risks)}${aiList('สิ่งที่ยังไม่ทราบ',summary.unknowns)}<p class="small-note">AI ${escapeHtml(summary.provider)} · ความมั่นใจ ${summary.confidence==='medium'?'ปานกลาง':'ต่ำ'} · สรุปจากหัวข้อข่าวสูงสุด 10 รายการ</p>`:result.aiError?`<p class="form-error" role="alert">${escapeHtml(result.aiError)} — ยังเปิดอ่านข่าวต้นทางได้ด้านล่าง</p>`:'<p class="small-note">ไม่พบข่าวที่เกี่ยวข้องในช่วงนี้ จึงไม่มีผลสรุป AI</p>'}<div class="ai-sources"><b>ข่าวที่พบและลิงก์ต้นทาง</b>${result.articles.map((item,index)=>`<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${index<10&&summary?'AI ใช้ · ':''}${escapeHtml(item.source)} · ${escapeHtml(item.title)} · ${escapeHtml(dateLabel(item.publishedAt))} ↗</a>`).join('')}</div><p class="risk-inline">AI สรุปจากหัวข้อข่าวเท่านั้น อาจขาดบริบทและไม่ครอบคลุมทุกสำนัก ตรวจบทความต้นทางก่อนตัดสินใจลงทุน</p></div>`:''}</section>`;
}
function updateResearchPanel(){const node=document.querySelector('#research-panel');if(node)node.outerHTML=researchPanel();}
document.addEventListener('input',event=>{if(event.target.id==='company-query'){resetResearch();updateResearchPanel();}});
document.addEventListener('click',async event=>{
  if(!currentUser)return;
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-research-find')){
    const term=query.trim(),epoch=++researchEpoch,userId=currentUser.id;
    researchError='';researchResult=null;researchCompanies=[];researchCompany=null;
    if(term.length<2||term.length>80){researchError='กรอกชื่อบริษัทหรือ ticker 2 ถึง 80 ตัวอักษร';updateResearchPanel();return;}
    researchBusy='companies';updateResearchPanel();
    try{const data=await api('/api/research/companies?q='+encodeURIComponent(term),{timeout:20000});if(epoch!==researchEpoch||currentUser?.id!==userId)return;researchCompanies=data.items;researchError=data.items.length?'':'ไม่พบบริษัทที่ตรงกับคำค้น ลองชื่อตลาดหุ้นหรือตัวย่ออื่น';}
    catch(error){if(epoch!==researchEpoch)return;researchError=error.message;if(error.status===401)showSignedOut('login');}
    finally{if(epoch===researchEpoch){researchBusy='';updateResearchPanel();}}
  }
  if(button.hasAttribute('data-research-index')){
    researchCompany=researchCompanies[Number(button.dataset.researchIndex)]||null;researchResult=null;researchError='';updateResearchPanel();
  }
  if(button.hasAttribute('data-research-months')){researchMonths=Number(button.dataset.researchMonths);researchResult=null;researchError='';updateResearchPanel();}
  if(button.hasAttribute('data-research-run')&&researchCompany){
    const epoch=++researchEpoch,userId=currentUser.id,company=researchCompany;
    researchBusy='news';researchError='';researchResult=null;updateResearchPanel();
    try{const data=await api('/api/research',{method:'POST',body:{symbol:company.symbol,name:company.name,months:researchMonths},timeout:200000});if(epoch!==researchEpoch||currentUser?.id!==userId)return;researchResult=data;}
    catch(error){if(epoch!==researchEpoch)return;researchError=error.message;if(error.status===401)showSignedOut('login');}
    finally{if(epoch===researchEpoch){researchBusy='';updateResearchPanel();}}
  }
});
