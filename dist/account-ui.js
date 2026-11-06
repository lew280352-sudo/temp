let onboardingDraft=null,onboardingDraftEpoch=-1,onboardingDraftRevision=0;

function setupDraft(){
  if(onboardingDraftEpoch!==authEpoch){onboardingDraft=structuredClone(state);onboardingDraftEpoch=authEpoch;onboardingDraftRevision=stateRevision;}
  return onboardingDraft;
}

function renderWelcome(){
  const draft=setupDraft();
  const directFeeds=draft.sources.filter(source=>presetSources.some(preset=>['apple','microsoft','nvidia','netflix'].includes(preset.id)&&preset.url===source.url));
  return header('เริ่มจากบริษัทที่คุณสนใจ','เลือกบริษัทและแหล่งข่าว เปลี่ยนรายการได้เสมอในภายหลัง')+`
    <form id="onboarding-form" class="setup-layout">
      <section class="card setup-companies" aria-labelledby="setup-companies-title">
        <h2 id="setup-companies-title">เลือกบริษัทที่อยากติดตาม</h2>
        <p class="muted">เลือกได้หลายบริษัท ค้นด้วยชื่อหรือตัวย่อหุ้น</p>
        <label class="field">ค้นหาบริษัท<input type="search" id="setup-query" placeholder="เช่น Apple หรือ NVDA" autocomplete="off"></label>
        <div class="setup-company-list">${stocks.map(company=>`<label class="setup-option" data-setup-company="${escapeHtml(`${company.symbol} ${company.name} ${company.thai}`.toLocaleLowerCase())}"><input type="checkbox" name="companies" value="${escapeHtml(company.symbol)}" ${draft.watchlist.includes(company.symbol)?'checked':''}>${companyLogo(company.symbol)}<span><b>${escapeHtml(company.symbol)}</b><small>${escapeHtml(company.name)}</small></span></label>`).join('')}</div>
        <p class="small-note" id="setup-selection" aria-live="polite">เลือกแล้ว ${draft.watchlist.length} บริษัท</p>
      </section>
      <section class="card setup-sources" aria-labelledby="setup-sources-title">
        <h2 id="setup-sources-title">เลือกฟีดข่าวบริษัท</h2>
        <p class="muted">หัวข้อข่าวจากบริษัทโดยตรง เปิดต้นฉบับได้ทุกข่าว</p>
        ${directFeeds.map(source=>`<label class="setup-source-option"><input type="checkbox" name="sources" value="${escapeHtml(source.id)}" ${source.enabled?'checked':''}><span>${escapeHtml(source.name)}</span></label>`).join('')||'<p class="small-note">ยังไม่ได้เพิ่มฟีดบริษัทเริ่มต้น เลือกเพิ่มได้ในหน้าแหล่งข้อมูล</p>'}
        <p class="small-note">เพิ่มแหล่งข่าวอื่นได้ในเมนูแหล่งข้อมูล การเลือกฟีดไม่ได้รับประกันว่าจะมีข่าวใหม่ทุกวัน</p>
        <div class="setup-privacy">${icon('shield')}<p>เก็บเฉพาะบริษัทและแหล่งข่าวที่เลือก ไม่ต้องกรอกข้อมูลการถือหุ้น</p></div>
      </section>
      <div class="setup-actions"><p class="form-error" role="alert" tabindex="-1" id="onboarding-error"></p><button class="btn primary" type="submit">บันทึกและเปิดข่าวของฉัน</button><button class="text-button" type="button" data-skip-onboarding>ข้ามไปก่อน</button></div>
    </form>`;
}

async function submitOnboarding(form,action){
  if(isSaving||!currentUser)return;
  const epoch=authEpoch,userId=currentUser.id,error=form.querySelector('.form-error');
  const controls=[...form.querySelectorAll('input,button')];error.textContent='';isSaving=true;controls.forEach(el=>el.disabled=true);
  const submit=form.querySelector('[type=submit]'),submitLabel=submit.textContent;submit.textContent='กำลังบันทึก…';form.setAttribute('aria-busy','true');
  try{
    const result=await api('/api/onboarding',{method:'POST',body:{action,userId,revision:onboardingDraftRevision,...(action==='complete'?{state:setupDraft()}:{})}});
    if(!sameSession(epoch,userId))return;
    state=result.state;stateRevision=result.revision;committedState=structuredClone(state);onboardingDraft=null;onboardingDraftEpoch=-1;
    newsFilter=state.watchlist.length?'watchlist':'all';loadQuotes();navigate(action==='complete'?'news':'overview');loadNews();
    toast(action==='complete'?'บันทึกรายการติดตามแล้ว':'ข้ามการตั้งค่าแล้ว กลับมาเลือกได้ในเมนูเพิ่มเติม');
  }catch(failure){
    if(!sameSession(epoch,userId)||!form.isConnected)return;
    if(failure.status===401){showSignedOut('login');return;}
    if(failure.status===409){
      // Keep the user's draft visible; a newer tab's preferences are never overwritten.
      error.textContent='ข้อมูลเปลี่ยนจากอีกแท็บ เปิดหน้าเริ่มใช้งานใหม่เพื่อตรวจรายการล่าสุดก่อนบันทึก';
      error.insertAdjacentHTML('beforeend',' <button type="button" class="text-button" data-reload-setup>โหลดรายการล่าสุด</button>');
    }else error.textContent=failure.message;
    error.scrollIntoView({block:'center',behavior:'instant'});error.focus({preventScroll:true});
  }finally{isSaving=false;if(form.isConnected){controls.forEach(el=>el.disabled=false);submit.textContent=submitLabel;form.removeAttribute('aria-busy');}}
}

function renderDevices(){
  queueMicrotask(loadDevices);
  return header('อุปกรณ์ที่เข้าสู่ระบบ','ดูและยกเลิกเซสชันของบัญชีคุณ', '<button class="btn" data-refresh-devices>รีเฟรช</button>')+`
    <section class="card devices-panel"><p class="small-note">ชื่อเบราว์เซอร์และระบบเป็นข้อมูลโดยประมาณ ไม่เก็บ IP หรือใช้ระบุตำแหน่ง เซสชันหมดอายุภายใน 12 ชั่วโมงหลังเข้าสู่ระบบ</p>
    <div id="device-list" aria-live="polite"><p role="status">กำลังโหลดอุปกรณ์…</p></div>
    <button class="btn" data-revoke-other-devices>ออกจากระบบอุปกรณ์อื่นทั้งหมด</button>
    <p class="small-note">การออกจากระบบจะยกเลิก Push ที่เชื่อมกับเซสชันนั้นด้วย อุปกรณ์ Push จากเวอร์ชันเก่าที่ยังไม่ทราบเซสชันจะคงอยู่จนกว่าจะปิด Push บนอุปกรณ์เดิม</p></section>`;
}

async function loadDevices(){
  const list=$('#device-list');if(!currentUser||!list||list.dataset.loading)return;
  const epoch=authEpoch,userId=currentUser.id;list.dataset.loading='true';list.setAttribute('aria-busy','true');
  try{
    const result=await api('/api/sessions');if(!sameSession(epoch,userId)||!list.isConnected)return;
    list.innerHTML=result.sessions.map(device=>`<article class="device-row" data-device-row ${device.current?'data-current-device':''}>
      <span class="device-icon">${icon('shield')}</span><div class="device-details"><h2>${escapeHtml(device.name)} ${device.current?'<span class="device-current">อุปกรณ์นี้</span>':''}</h2>
      <dl><div><dt>เข้าสู่ระบบ</dt><dd>${device.createdAt?escapeHtml(dateLabel(device.createdAt)):'เซสชันจากเวอร์ชันเดิม'}</dd></div><div><dt>ใช้งานล่าสุด</dt><dd>${device.lastSeenAt?escapeHtml(dateLabel(device.lastSeenAt)):'ยังไม่มีข้อมูล'}</dd></div><div><dt>หมดอายุ</dt><dd>${escapeHtml(dateLabel(device.expiresAt))}</dd></div></dl></div>
      <button class="btn" data-device-revoke="${escapeHtml(device.id)}" data-device-name="${escapeHtml(device.name)}" data-device-current="${device.current}" aria-label="ออกจากระบบ ${escapeHtml(device.name)}${device.current?' อุปกรณ์นี้':''}">ออกจากระบบ</button></article>`).join('')||'<p class="empty">ไม่พบเซสชันที่ยังใช้งานได้</p>';
  }catch(error){if(!sameSession(epoch,userId)||!list.isConnected)return;if(error.status===401){showSignedOut('login');return;}list.innerHTML=`<p class="form-error" role="alert">${escapeHtml(error.message)}</p><button class="text-button" data-refresh-devices>ลองใหม่</button>`;}
  finally{delete list.dataset.loading;list.removeAttribute('aria-busy');}
}

document.addEventListener('input',event=>{
  if(event.target.id==='setup-query'){
    const query=event.target.value.trim().toLocaleLowerCase();document.querySelectorAll('[data-setup-company]').forEach(row=>row.hidden=!row.dataset.setupCompany.includes(query));
  }
});
document.addEventListener('change',event=>{
  if(!event.target.closest('#onboarding-form'))return;
  const draft=setupDraft();
  if(event.target.name==='companies'){
    draft.watchlist=[...document.querySelectorAll('#onboarding-form [name=companies]:checked')].map(el=>el.value);
    $('#setup-selection').textContent=`เลือกแล้ว ${draft.watchlist.length} บริษัท`;
  }
  if(event.target.name==='sources'){const source=draft.sources.find(s=>s.id===event.target.value);if(source)source.enabled=event.target.checked;}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!currentUser)return;
  if(button.hasAttribute('data-skip-onboarding'))submitOnboarding(button.closest('form'),'skip');
  if(button.hasAttribute('data-refresh-devices'))loadDevices();
  if(button.hasAttribute('data-reload-setup')){
    const epoch=authEpoch,userId=currentUser.id;button.disabled=true;
    try{const result=await api('/api/session');if(!sameSession(epoch,userId))return;if(result.user?.id!==userId){showSignedOut('login');return;}state=result.state;stateRevision=result.revision;committedState=structuredClone(state);onboardingDraftEpoch=-1;navigate('welcome');}
    catch(error){if(sameSession(epoch,userId)){if(error.status===401)showSignedOut('login');else toast(error.message);}}
    finally{if(button.isConnected)button.disabled=false;}
  }
  if(button.hasAttribute('data-device-revoke')||button.hasAttribute('data-revoke-other-devices')){
    const others=button.hasAttribute('data-revoke-other-devices'),current=button.dataset.deviceCurrent==='true';
    openModal(others?'ออกจากระบบอุปกรณ์อื่นทั้งหมด':'ออกจากระบบอุปกรณ์',`<p>${others?'อุปกรณ์อื่นจะต้องเข้าสู่ระบบใหม่ อุปกรณ์นี้ยังใช้งานต่อได้':current?'คุณจะออกจากระบบบนอุปกรณ์นี้':'ออกจากระบบ '+escapeHtml(button.dataset.deviceName)+' อุปกรณ์นั้นจะต้องเข้าสู่ระบบใหม่'}</p><p class="form-error" role="alert"></p><button class="btn primary" data-confirm-device-revoke="${escapeHtml(others?'others':button.dataset.deviceRevoke)}">ยืนยันออกจากระบบ</button>`);
  }
  if(button.hasAttribute('data-confirm-device-revoke')){
    const epoch=authEpoch,userId=currentUser.id,others=button.dataset.confirmDeviceRevoke==='others';button.disabled=true;
    try{
      const result=await api(others?'/api/sessions/revoke-others':'/api/sessions/revoke',{method:'POST',body:others?{}:{id:button.dataset.confirmDeviceRevoke}});
      if(!sameSession(epoch,userId))return;
      if(result.currentRevoked){showSignedOut('login','ออกจากระบบอุปกรณ์นี้แล้ว');return;}
      if(button.isConnected&&$('#modal').open)$('#modal').close();loadDevices();toast(`ออกจากระบบแล้ว ${result.revoked} เซสชัน`);
    }catch(error){if(!sameSession(epoch,userId)||!button.isConnected)return;if(error.status===401){showSignedOut('login');return;}$('#modal-body .form-error').textContent=error.message;}
    finally{if(button.isConnected)button.disabled=false;}
  }
});
document.addEventListener('submit',event=>{if(event.target.id==='onboarding-form'){event.preventDefault();submitOnboarding(event.target,'complete');}});
