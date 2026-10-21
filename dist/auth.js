let authMode='register',authBusy=false;
async function api(url,{method='GET',body:payload,timeout=20000}={}){
  let response;try{response=await fetch(url,{method,credentials:'same-origin',signal:AbortSignal.timeout(timeout),headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});}catch{throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่าเปิด StockLens อยู่');}
  let result;try{result=await response.json();}catch{throw new Error('เซิร์ฟเวอร์ยังไม่พร้อม กรุณาเปิดแอปผ่าน npm start');}
  if(!response.ok){const error=new Error(result.error||'ดำเนินการไม่สำเร็จ');error.status=response.status;throw error;}return result;
}
function authForm(mode,message='',email=''){
  authMode=mode;const register=mode==='register';
  $('#auth-content').innerHTML=`<div class="auth-tabs" role="group" aria-label="เลือกสมัครสมาชิกหรือเข้าสู่ระบบ"><button data-auth-mode="register" class="${register?'active':''}" aria-pressed="${register}">สร้างบัญชี / Register</button><button data-auth-mode="login" class="${!register?'active':''}" aria-pressed="${!register}">เข้าสู่ระบบ / Login</button></div>${message?`<div class="auth-success" role="status">${escapeHtml(message)}</div>`:''}<h2>${register?'เริ่มต้นมองข่าวในแบบของคุณ':'ยินดีต้อนรับกลับมา'}</h2><p class="auth-description">${register?'สร้างบัญชีเพื่อเลือกบริษัทและแหล่งข่าว<br>ที่อยากให้เราติดตามเป็นพิเศษ':'เข้าสู่ระบบเพื่อกลับไปยังบริษัท<br>และแหล่งข่าวที่คุณเลือกไว้'}</p><form class="auth-form" id="${register?'register-form':'login-form'}">${register?'<label class="field">ชื่อที่แสดง<input name="name" autocomplete="name" minlength="2" maxlength="80" placeholder="ชื่อของคุณ" required></label>':''}<label class="field">อีเมล<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${escapeHtml(email)}" required></label><label class="field">รหัสผ่าน<span class="password-input"><input name="password" id="auth-password" type="password" autocomplete="${register?'new-password':'current-password'}" ${register?'minlength="10"':''} maxlength="128" placeholder="${register?'สร้างรหัสผ่านอย่างน้อย 10 ตัวอักษร':'กรอกรหัสผ่านของคุณ'}" required><button type="button" data-password-toggle="auth-password" aria-label="แสดงรหัสผ่าน" aria-pressed="false">แสดง</button></span>${register?'<small>ใช้รหัสผ่าน 10–128 ตัวอักษร</small>':''}</label>${register?'<label class="field">ยืนยันรหัสผ่าน<span class="password-input"><input name="confirm" id="auth-confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" placeholder="กรอกรหัสผ่านอีกครั้ง" required><button type="button" data-password-toggle="auth-confirm" aria-label="แสดงรหัสผ่านยืนยัน" aria-pressed="false">แสดง</button></span></label>':''}<p class="form-error" id="auth-error" role="alert"></p><button class="btn primary" type="submit">${register?'สร้างบัญชีของฉัน':'เข้าสู่ระบบ'} ${icon('arrow')}</button></form><div class="auth-bottom">${register?'มีบัญชีอยู่แล้ว?':'ยังไม่มีบัญชี?'} <button data-auth-mode="${register?'login':'register'}">${register?'เข้าสู่ระบบ':'สร้างบัญชีใหม่'}</button></div>`;
  if(!register){
    $('#auth-password').closest('label').insertAdjacentHTML('afterend','<label class="field">รหัสจากแอป Authenticator (หากเปิด MFA)<input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="รหัส 6 หลัก"></label>');
    $('#auth-content').insertAdjacentHTML('beforeend','<button class="text-button recover-link" data-recover>ลืมรหัสผ่าน? ใช้รหัสกู้คืน</button>');
  }
}
function showSignedOut(mode='register',message='',email=''){
  currentUser=null;stateRevision=0;state=structuredClone(defaults);committedState=structuredClone(defaults);query='';newsFilter='all';selectedStock='AAPL';resetNews();resetQuotes();resetAI();resetForecast();resetResearch();
  if($('#modal').open)$('#modal').close();$('#modal-body').innerHTML='';$('#main').innerHTML='';
  document.querySelectorAll('[data-user-name],[data-user-email],[data-user-avatar]').forEach(el=>el.textContent='');
  document.body.classList.add('signed-out');history.replaceState(null,'','#'+mode);authForm(mode,message,email);window.scrollTo(0,0);
}
function enterApp(result){
  currentUser=result.user;state=result.state;stateRevision=result.revision;committedState=structuredClone(state);selectedStock=state.watchlist.find(symbol=>stocks.some(s=>s.symbol===symbol))||'AAPL';resetNews();resetQuotes();resetAI();resetForecast();resetResearch();
  document.querySelectorAll('[data-user-name]').forEach(el=>el.textContent=currentUser.name);
  document.querySelectorAll('[data-user-email]').forEach(el=>el.textContent=currentUser.email);
  document.querySelectorAll('[data-user-avatar]').forEach(el=>el.textContent=Array.from(currentUser.name)[0].toUpperCase());
  const requested=location.hash.slice(1);
  $('#auth-content').innerHTML='';document.body.classList.remove('signed-out');navigate(['overview','news','following','portfolio','insights','search','alerts','sources'].includes(requested)?requested:'overview');loadNews();loadAIStatus();if(requested!=='following')loadQuotes();
}
const presetSources=[
  {id:'apple',name:'Apple Newsroom',symbol:'AAPL',url:'https://www.apple.com/newsroom/'},
  {id:'microsoft',name:'Microsoft News',symbol:'MSFT',url:'https://news.microsoft.com/'},
  {id:'nvidia',name:'NVIDIA Newsroom',symbol:'NVDA',url:'https://nvidianews.nvidia.com/'},
  {id:'netflix',name:'Netflix Investor News',symbol:'NFLX',url:'https://ir.netflix.net/'},
  {id:'fed-press',name:'Federal Reserve · ข่าวประชาสัมพันธ์',symbol:'',url:'https://www.federalreserve.gov/feeds/press_all.xml',type:'finance'},
  {id:'fed-monetary',name:'Federal Reserve · นโยบายการเงิน',symbol:'',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',type:'finance'}
];
function renderSourceManager(){
  if(stocks.length&&!presetSources.some(source=>source.id==='market-aapl'))presetSources.push(...stocks.map(s=>({id:`market-${s.symbol.toLowerCase().replace('.','-')}`,name:`ข่าวการเงิน · ${s.symbol}`,symbol:s.symbol,url:`https://finnhub.io/?symbol=${encodeURIComponent(s.symbol)}`,type:'finance'})));
  const typeNames={company:'เว็บไซต์บริษัท',partner:'บริษัทคู่ค้า',finance:'แหล่งข่าวการเงิน'};
  return header('แหล่งข้อมูลที่ฉันสนใจ','บอกว่าอยากให้เราดูข่าวจากเว็บไซต์ไหนเป็นพิเศษ')+`<div class="info-box">เราเก็บเฉพาะเว็บไซต์และบริษัทที่คุณเลือก ไม่ขอข้อมูลพอร์ต · ดึงข่าว RSS จาก 4 บริษัท ข่าวเศรษฐกิจจาก Federal Reserve ที่ตรวจสอบแล้ว และข่าวการเงินผ่าน Finnhub สำหรับ 36 บริษัทเมื่อมีคีย์ URL อื่นที่ยังไม่รองรับจะเป็นบุ๊กมาร์ก</div><label class="source-preset-search">ค้นหาฟีดพร้อมใช้<input id="source-preset-query" type="search" placeholder="เช่น AAPL, NVDA หรือ Federal Reserve" autocomplete="off"></label><div class="source-presets">${presetSources.filter(p=>!state.sources.some(s=>s.url.replace(/\/$/,'')===p.url.replace(/\/$/,''))).map(p=>`<button class="btn" data-add-feed="${p.id}">เพิ่มฟีด ${p.name}</button>`).join('')}</div><div class="source-layout"><section class="card"><div class="sources-summary"><h2>เว็บไซต์ที่อยากให้ติดตาม</h2><span>${state.sources.length} เว็บไซต์ · ${state.sources.filter(s=>s.enabled).length} รายการที่เปิด</span></div>${state.sources.map(s=>`<article class="source-entry"><div class="source-entry-top"><span class="source-initial">${escapeHtml(s.name.slice(0,2).toUpperCase())}</span><div class="source-description"><h3 class="source-title">${escapeHtml(s.name)}</h3><a class="source-url" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.url)} ↗</a></div><input class="switch" type="checkbox" data-source-toggle="${escapeHtml(s.id)}" aria-label="ติดตาม ${escapeHtml(s.name)}" ${s.enabled?'checked':''}></div><div class="source-entry-bottom"><span>${typeNames[s.type]}</span>${s.symbol?`<span>${s.symbol}</span>`:''}<span>${presetSources.some(p=>p.url===s.url)?'ดึงข่าวอัตโนมัติ':'บันทึกเป็นบุ๊กมาร์ก'}</span><button class="remove" data-source-remove="${escapeHtml(s.id)}">ลบ</button></div></article>`).join('')||'<div class="empty">ยังไม่มีเว็บไซต์ที่เลือก<br>เพิ่ม URL ที่อยากให้เราติดตามได้เลย</div>'}</section><form id="source-form" class="card source-form"><h2>เพิ่มเว็บไซต์ข่าวที่สนใจ</h2><label class="field">ชื่อแหล่งข้อมูล<input name="name" maxlength="100" placeholder="เช่น ข่าวบริษัท หรือเว็บไซต์การเงิน" required></label><label class="field">URL เว็บไซต์<input name="url" type="url" maxlength="2048" placeholder="https://example.com/news" required></label><label class="field">ประเภทแหล่งข้อมูล<select name="type"><option value="company">เว็บไซต์บริษัท</option><option value="partner">บริษัทคู่ค้า</option><option value="finance">แหล่งข่าวการเงิน</option></select></label><label class="field">บริษัทที่เกี่ยวข้อง<select name="symbol"><option value="">ภาพรวม / ไม่ระบุบริษัท</option>${stocks.map(s=>`<option value="${s.symbol}">${s.symbol}</option>`).join('')}</select></label><p class="form-error" id="source-error" role="alert"></p><button class="btn primary" type="submit">${icon('plus')} บันทึกเว็บไซต์</button><p class="form-help" style="margin-top:13px">รายการนี้บันทึกแยกตามบัญชีของคุณ · เพิ่มได้สูงสุด 100 เว็บไซต์<br>เลือกฟีดที่ตรวจสอบแล้วด้านบนหรือกรอก URL ฟีด Federal Reserve ที่ตรงกันเพื่อให้ดึงข่าวจริง URL อื่นจะเป็นบุ๊กมาร์ก</p></form></div>`;
}
document.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.authMode&&!authBusy){authForm(button.dataset.authMode);history.replaceState(null,'','#'+button.dataset.authMode);}
  if(button.dataset.passwordToggle){const input=document.getElementById(button.dataset.passwordToggle),show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'ซ่อน':'แสดง';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน');}
  if(button.hasAttribute('data-logout')&&currentUser&&!authBusy){
    if(isSaving){toast('กำลังบันทึกข้อมูล กรุณารอสักครู่');return;}authBusy=true;button.disabled=true;
    try{try{await window.disablePushForLogout?.();}catch{}await api('/api/logout',{method:'POST',body:{}});showSignedOut('login','ออกจากระบบเรียบร้อยแล้ว');}catch(error){toast(error.message);}finally{authBusy=false;button.disabled=false;}
  }
  if(button.dataset.addFeed&&currentUser&&!isSaving){const preset=presetSources.find(p=>p.id===button.dataset.addFeed);if(preset&&!state.sources.some(s=>s.url===preset.url)){state.sources.push({...preset,id:crypto.randomUUID(),type:preset.type||'company',enabled:true});if(await save()){loadNews();render();}}}
  if(button.dataset.sourceRemove&&currentUser&&!isSaving){const s=state.sources.find(v=>v.id===button.dataset.sourceRemove);if(!s)return;openModal('ลบแหล่งข้อมูล',`<p>นำ ${escapeHtml(s.name)} ออกจากรายการเว็บไซต์ที่ติดตาม?</p><button class="btn primary" data-source-confirm="${escapeHtml(s.id)}">ยืนยันลบเว็บไซต์</button>`);}
  if(button.dataset.sourceConfirm&&currentUser&&!isSaving){state.sources=state.sources.filter(s=>s.id!==button.dataset.sourceConfirm);if(await save()){loadNews();if($('#modal').open)$('#modal').close();render();toast('ลบแหล่งข้อมูลแล้ว');}}
});
document.addEventListener('input',e=>{if(e.target.id!=='source-preset-query')return;const term=e.target.value.trim().toLocaleLowerCase();document.querySelectorAll('.source-presets [data-add-feed]').forEach(button=>{button.hidden=!button.textContent.toLocaleLowerCase().includes(term);});});
document.addEventListener('change',async e=>{
  const id=e.target.dataset.sourceToggle;if(!id||!currentUser)return;if(isSaving){e.target.checked=!e.target.checked;return;}
  const source=state.sources.find(s=>s.id===id);if(!source)return;source.enabled=e.target.checked;const ok=await save();if(ok)loadNews({redraw:false});render();if(ok)toast(source.enabled?'เลือกติดตามเว็บไซต์นี้แล้ว':'พักการติดตามเว็บไซต์นี้แล้ว');
});
document.addEventListener('submit',async e=>{
  const form=e.target;
  if(['register-form','login-form'].includes(form.id)){
    e.preventDefault();if(authBusy)return;const register=form.id==='register-form',errorEl=$('#auth-error');errorEl.textContent='';
    if(register&&form.elements.password.value!==form.elements.confirm.value){errorEl.textContent='รหัสผ่านทั้งสองช่องไม่ตรงกัน';form.elements.confirm.focus();return;}
    authBusy=true;const button=form.querySelector('[type=submit]'),original=button.innerHTML;button.disabled=true;button.textContent=register?'กำลังสร้างบัญชี…':'กำลังเข้าสู่ระบบ…';
    try{const email=form.elements.email.value;const result=await api(register?'/api/register':'/api/login',{method:'POST',body:{email,password:form.elements.password.value,...(register?{name:form.elements.name.value}:{totp:form.elements.totp.value.trim()})}});if(register){authForm('login','สร้างบัญชีแล้ว เก็บรหัสกู้คืนด้านล่างก่อนเข้าสู่ระบบ',email);$('#auth-content').insertAdjacentHTML('beforeend',recoveryNotice(result.recoveryCode));history.replaceState(null,'','#login');$('#auth-password').focus();}else enterApp(result);}
    catch(error){errorEl.textContent=error.message;}finally{authBusy=false;button.disabled=false;button.innerHTML=original;}
  }
  if(form.id==='source-form'){
    e.preventDefault();if(!currentUser||isSaving)return;const errorEl=$('#source-error');errorEl.textContent='';
    let url;try{url=new URL(form.elements.url.value.trim());if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error();url.hash='';}catch{errorEl.textContent='ใช้ URL แบบ https:// หรือ http:// ที่ไม่มีรหัสผ่านในลิงก์';return;}
    if(state.sources.some(s=>s.url===url.href)){errorEl.textContent='มี URL นี้ในรายการแล้ว';return;}
    const button=form.querySelector('[type=submit]');button.disabled=true;
    state.sources.push({id:crypto.randomUUID(),name:form.elements.name.value.trim(),url:url.href,type:form.elements.type.value,symbol:form.elements.symbol.value,enabled:true});
    const ok=await save();button.disabled=false;if(ok){loadNews({redraw:false});render();toast(presetSources.some(p=>p.url===url.href)?'เพิ่มฟีดข่าวที่ดึงอัตโนมัติแล้ว':'บันทึกเว็บไซต์เป็นบุ๊กมาร์กแล้ว');}
  }
});
function connectionHelp(){
  document.body.classList.add('signed-out');$('#auth-content').innerHTML='<div class="eyebrow">START YOUR WORKSPACE</div><h2>เปิด StockLens ผ่านเซิร์ฟเวอร์</h2><p class="auth-description">ระบบสมัครสมาชิกและเข้าสู่ระบบต้องใช้เซิร์ฟเวอร์ของแอป</p><div class="auth-connection">เปิด Terminal ในโฟลเดอร์ stocklens แล้วรัน<code>npm.cmd start</code>จากนั้นเปิด <a href="http://127.0.0.1:4173">http://127.0.0.1:4173 ↗</a></div>';
}
async function boot(){
  if(location.protocol==='file:'){connectionHelp();return;}
  try{const [result,catalog]=await Promise.all([api('/api/session'),import('/catalog.js')]);stocks=catalog.companies;if(result.user)enterApp(result);else showSignedOut(location.hash==='#login'?'login':'register');}catch{connectionHelp();}
}
window.addEventListener('pageshow',e=>{if(e.persisted)boot();});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&currentUser&&!authBusy&&!isSaving){try{const result=await api('/api/session');if(!result.user||result.user.id!==currentUser.id)showSignedOut('login','กรุณาเข้าสู่ระบบใหม่');}catch{}}});
function recoveryNotice(code){return `<section class="recovery-notice"><h3>รหัสกู้คืนบัญชี · แสดงครั้งเดียว</h3><p>เก็บในตัวจัดการรหัสผ่านหรือที่ปลอดภัย รหัสนี้เปลี่ยนรหัสผ่านและเข้าถึงบัญชีได้ หากหายพร้อมรหัสผ่านจะกู้บัญชีไม่ได้</p><label class="field">รหัสกู้คืน<input aria-label="รหัสกู้คืน" readonly value="${escapeHtml(code)}" spellcheck="false"></label><p class="small-note">รหัสเดิมใช้ไม่ได้หลังจากกู้คืนหรือสร้างรหัสใหม่</p></section>`;}
document.addEventListener('click',e=>{
  if(!e.target.closest('[data-recover]')||authBusy)return;
  $('#auth-content').innerHTML='<h2>กู้คืนบัญชี</h2><p>ใช้อีเมลและรหัสกู้คืนที่เก็บไว้ ไม่ต้องรออีเมลยืนยัน</p><form id="recover-form" class="auth-form"><label class="field">อีเมล<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label class="field">รหัสกู้คืน<input name="code" autocomplete="off" minlength="48" maxlength="48" required></label><label class="field">รหัสผ่านใหม่<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><label class="field">ยืนยันรหัสผ่านใหม่<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><p id="recover-error" class="form-error" role="alert"></p><button class="btn primary" type="submit">เปลี่ยนรหัสผ่าน</button></form><button class="text-button recover-link" data-auth-mode="login">กลับเข้าสู่ระบบ</button>';
});
document.addEventListener('submit',async e=>{
  const form=e.target;if(form.id!=='recover-form')return;e.preventDefault();if(authBusy)return;
  const errorEl=$('#recover-error');errorEl.textContent='';
  if(form.elements.password.value!==form.elements.confirm.value){errorEl.textContent='รหัสผ่านทั้งสองช่องไม่ตรงกัน';return;}
  authBusy=true;const button=form.querySelector('[type=submit]');button.disabled=true;
  try{const email=form.elements.email.value,result=await api('/api/recover',{method:'POST',body:{email,code:form.elements.code.value,password:form.elements.password.value}});authForm('login','เปลี่ยนรหัสผ่านแล้ว ทุกอุปกรณ์ถูกออกจากระบบ เก็บรหัสกู้คืนใหม่ก่อนเข้าใช้',email);$('#auth-content').insertAdjacentHTML('beforeend',recoveryNotice(result.recoveryCode));}
  catch(error){errorEl.textContent=error.message;}finally{authBusy=false;button.disabled=false;}
});
boot();
