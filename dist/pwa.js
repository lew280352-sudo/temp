let installPrompt=null;
const installButton=document.querySelector('#install-app');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installButton.textContent='ติดตั้งแอป';});
installButton.addEventListener('click',async()=>{
  if(installPrompt){const prompt=installPrompt;installPrompt=null;await prompt.prompt();await prompt.userChoice;}
  else{document.querySelector('#install-help').hidden=!document.querySelector('#install-help').hidden;}
});
window.addEventListener('appinstalled',()=>{installPrompt=null;installButton.textContent='ติดตั้งแล้ว';document.querySelector('#install-help').hidden=true;});
function connectionStatus(){document.querySelector('#offline-status').hidden=navigator.onLine;}
window.addEventListener('online',connectionStatus);window.addEventListener('offline',connectionStatus);connectionStatus();
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{document.querySelector('#install-help').textContent='ยังเตรียมโหมดติดตั้งไม่ได้ ลองโหลดหน้าใหม่เมื่อออนไลน์';});
