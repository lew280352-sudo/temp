const securityMain=document.querySelector('#main');
let securityLoading=false;

async function refreshSecurityCard(){
  const card=document.querySelector('#security-card');
  if(!card||!currentUser||securityLoading)return;
  securityLoading=true;
  try{
    const status=await api('/api/security');
    if(!document.contains(card)||!currentUser)return;
    card.innerHTML=`<h2>บัญชีและความปลอดภัย</h2><p>วิธีเข้าสู่ระบบ: <b>${status.mfaEnabled?'รหัสผ่าน + Authenticator':status.emailLoginEnabled?'รหัสผ่าน + รหัสอีเมล':'รหัสผ่าน'}</b> · อีเมล: <b>${status.emailVerified?'ยืนยันแล้ว':'ยังไม่ยืนยัน'}</b></p><p class="small-note">การลบบัญชีจะลบข้อมูลและเซสชันในฐานข้อมูลใช้งาน แต่สำเนาสำรองเดิมต้องจัดการแยกต่างหาก</p><div class="security-actions">${status.mfaEnabled?`<button class="btn" data-security-disable>ปิด Authenticator${status.emailLoginEnabled?' แล้วใช้รหัสอีเมล':''}</button>`:status.emailLoginEnabled?'':`<button class="btn" data-security-setup ${status.mfaAvailable?'':'disabled'}>เปิด MFA ด้วย Authenticator</button>`}${!status.emailVerified?`<button class="btn" data-email-verification ${status.emailAvailable?'':'disabled'}>ส่งลิงก์ยืนยันอีเมล</button>`:''}<button class="btn" data-security-delete>ลบบัญชี</button></div>${status.emailLoginEnabled?'':'<p class="small-note">รหัสอีเมลหลังกรอกรหัสผ่านจะพร้อมใช้เมื่อผู้ดูแลตั้งค่า SMTP และเปิด EMAIL_LOGIN_OTP_ENABLED</p>'}${status.mfaAvailable||status.emailLoginEnabled?'':'<p class="small-note">ผู้ดูแลต้องตั้ง MFA_ENCRYPTION_KEY ใน .env ก่อนเปิด Authenticator</p>'}${status.emailAvailable?'':'<p class="small-note">ผู้ดูแลต้องตั้งค่า SMTP เพื่อส่งอีเมลยืนยัน</p>'}`;
  }catch(error){if(document.contains(card))card.innerHTML=`<h2>บัญชีและความปลอดภัย</h2><p role="alert" class="form-error">${escapeHtml(error.message)}</p>`;}
  finally{securityLoading=false;const latest=document.querySelector('#security-card');if(latest&&latest!==card)queueMicrotask(refreshSecurityCard);}
}
new MutationObserver(()=>{
  if(!currentUser||!securityMain.querySelector('#alert-form')||securityMain.querySelector('#security-card'))return;
  securityMain.insertAdjacentHTML('beforeend','<section class="card settings" id="security-card"><h2>บัญชีและความปลอดภัย</h2><p>กำลังตรวจสถานะ…</p></section>');
  refreshSecurityCard();
}).observe(securityMain,{childList:true});

document.addEventListener('click',event=>{
  if(!currentUser)return;
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-security-setup'))openModal('เปิด MFA','<form id="mfa-setup-form"><p>ใส่รหัสผ่านเพื่อสร้างรหัสลับสำหรับแอป Authenticator</p><label class="field">รหัสผ่าน<input type="password" name="password" autocomplete="current-password" required></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">สร้างรหัสลับ</button></form>');
  if(button.hasAttribute('data-security-disable'))openModal('ปิด MFA','<form id="mfa-disable-form"><label class="field">รหัสผ่าน<input type="password" name="password" autocomplete="current-password" required></label><label class="field">รหัส Authenticator 6 หลัก<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">ยืนยันปิด MFA</button></form>');
  if(button.hasAttribute('data-security-delete'))openModal('ลบบัญชีถาวร',`<form id="account-delete-form"><p>ลบบัญชี ${escapeHtml(currentUser.email)} และข้อมูลที่ติดตามออกจากฐานข้อมูลใช้งาน กู้จากแอปไม่ได้</p><label class="field">พิมพ์อีเมลเพื่อยืนยัน<input type="email" name="confirm" autocomplete="off" required></label><label class="field">รหัสผ่าน<input type="password" name="password" autocomplete="current-password" required></label><label class="field">รหัส Authenticator (ถ้าเปิด MFA)<input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">ลบบัญชีถาวร</button></form>`);
  if(button.hasAttribute('data-email-verification')){
    button.disabled=true;
    api('/api/email/send-verification',{method:'POST',body:{}}).then(()=>toast('ส่งลิงก์ยืนยันไปที่อีเมลบัญชีแล้ว')).catch(error=>toast(error.message)).finally(()=>{if(document.contains(button))button.disabled=false;});
  }
});

document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['mfa-setup-form','mfa-enable-form','mfa-disable-form','account-delete-form'].includes(form.id))return;
  event.preventDefault();
  const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;
  try{
    if(form.id==='mfa-setup-form'){
      const result=await api('/api/mfa/setup',{method:'POST',body:{password:form.elements.password.value}});
      openModal('เพิ่ม StockLens ใน Authenticator',`<p>เพิ่มบัญชีด้วยรหัสลับนี้ภายใน ${result.expiresMinutes} นาที อย่าแชร์รหัสนี้กับผู้อื่น</p><p class="mfa-secret">${escapeHtml(result.secret)}</p><form id="mfa-enable-form"><label class="field">รหัส 6 หลักที่แอปแสดง<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">ยืนยันเปิด MFA</button></form>`);
      return;
    }
    if(form.id==='mfa-enable-form'){
      await api('/api/mfa/enable',{method:'POST',body:{code:form.elements.code.value.trim()}});
      $('#modal').close();refreshSecurityCard();toast('เปิด MFA แล้ว เก็บรหัสกู้คืนบัญชีไว้ด้วย');
    }
    if(form.id==='mfa-disable-form'){
      await api('/api/mfa/disable',{method:'POST',body:{password:form.elements.password.value,code:form.elements.code.value.trim()}});
      $('#modal').close();refreshSecurityCard();toast('ปิด MFA แล้ว');
    }
    if(form.id==='account-delete-form'){
      await api('/api/account/delete',{method:'POST',body:{confirm:form.elements.confirm.value.trim().toLowerCase(),password:form.elements.password.value,totp:form.elements.totp.value.trim()}});
      try{await window.forgetLocalPush?.();}catch{}
      showSignedOut('register','ลบบัญชีจากฐานข้อมูลใช้งานแล้ว');
    }
  }catch(error){const target=form.querySelector('.form-error');if(target)target.textContent=error.message;}
  finally{if(document.contains(button))button.disabled=false;}
});
