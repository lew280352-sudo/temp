const pushMain=document.querySelector('#main');
let pushLoading=false;
async function refreshPushCard(){
  const card=document.querySelector('#push-card');if(!card||!currentUser||pushLoading)return;
  pushLoading=true;
  try{
    const status=await api('/api/push/status');
    if(!document.contains(card)||!currentUser)return;
    const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&window.isSecureContext;
    const registration=supported?await navigator.serviceWorker.getRegistration():null;
    const subscription=registration?await registration.pushManager.getSubscription():null;
    if(!document.contains(card)||!currentUser)return;
    card.innerHTML=`<h2>แจ้งเตือนเมื่อปิดหน้าแอป</h2><p>${status.configured?'เซิร์ฟเวอร์พร้อมส่ง Web Push':'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Web Push'} · ${subscription?'อุปกรณ์นี้เปิดรับแล้ว':'อุปกรณ์นี้ยังไม่เปิดรับ'}</p><p class="small-note">ส่งข่าวใหม่จากแหล่งที่เปิดไว้ตามการตั้งค่าด้านบน เมื่อเซิร์ฟเวอร์ยังทำงานและอุปกรณ์เชื่อมอินเทอร์เน็ต คอมปิดหรือเซิร์ฟเวอร์หยุดจะไม่ส่งข่าว</p><div class="security-actions">${subscription?'<button class="btn" data-push-disable>ปิด Push บนอุปกรณ์นี้</button><button class="btn" data-push-test>ส่งทดสอบ</button>':`<button class="btn" data-push-enable ${status.configured&&supported?'':'disabled'}>เปิด Push บนอุปกรณ์นี้</button>`}</div>${supported?'':'<p class="small-note">ต้องเปิดผ่าน HTTPS หรือ localhost และใช้เบราว์เซอร์ที่รองรับ Push</p>'}`;
    card.dataset.publicKey=status.publicKey||'';
  }catch(error){if(document.contains(card))card.innerHTML=`<h2>Web Push</h2><p role="alert" class="form-error">${escapeHtml(error.message)}</p>`;}
  finally{pushLoading=false;const latest=document.querySelector('#push-card');if(latest&&latest!==card)queueMicrotask(refreshPushCard);}
}
new MutationObserver(()=>{
  if(!currentUser||!pushMain.querySelector('#alert-form')||pushMain.querySelector('#push-card'))return;
  pushMain.insertAdjacentHTML('beforeend','<section class="card settings" id="push-card"><h2>Web Push</h2><p>กำลังตรวจสถานะ…</p></section>');
  refreshPushCard();
}).observe(pushMain,{childList:true});

async function localPushSubscription(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return null;
  const registration=await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription()||null;
}
window.forgetLocalPush=async()=>{const sub=await localPushSubscription();if(sub)await sub.unsubscribe();};
window.disablePushForLogout=async()=>{
  const sub=await localPushSubscription();if(!sub)return;
  try{await api('/api/push/unsubscribe',{method:'POST',body:{endpoint:sub.endpoint}});}finally{await sub.unsubscribe();}
};
document.addEventListener('click',async event=>{
  if(!currentUser)return;const button=event.target.closest('button');if(!button||!['pushEnable','pushDisable','pushTest'].some(key=>key in button.dataset))return;
  button.disabled=true;
  try{
    if(button.dataset.pushEnable!==undefined){
      const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('ต้องอนุญาตการแจ้งเตือนก่อน');
      const registration=await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:document.querySelector('#push-card').dataset.publicKey});
      try{await api('/api/push/subscribe',{method:'POST',body:subscription.toJSON()});}catch(error){await subscription.unsubscribe();throw error;}
      toast('เปิด Push บนอุปกรณ์นี้แล้ว');
    }
    if(button.dataset.pushDisable!==undefined){await window.disablePushForLogout();toast('ปิด Push บนอุปกรณ์นี้แล้ว');}
    if(button.dataset.pushTest!==undefined){const result=await api('/api/push/test',{method:'POST',body:{}});toast(result.sent?`ส่งทดสอบแล้ว ${result.sent} อุปกรณ์`:'ยังส่งไม่สำเร็จ ตรวจการเชื่อมต่อและสิทธิ์แจ้งเตือน');}
    refreshPushCard();
  }catch(error){toast(error.message);button.disabled=false;}
});
