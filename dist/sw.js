// Cache only the public offline screen and icons. Never cache authenticated pages/API.
const CACHE='stocklens-public-v2';
const PUBLIC=['/offline.html','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('stocklens-public-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
});
self.addEventListener('push',event=>{
  let message={};try{message=event.data?.json()||{};}catch{}
  event.waitUntil(self.registration.showNotification('StockLens',{
    body:typeof message.body==='string'?message.body.slice(0,140):'มีข่าวใหม่จากแหล่งที่ติดตาม',
    icon:'/icon-192.png',badge:'/icon-192.png',tag:'stocklens-news',data:{url:'/'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(client=>new URL(client.url).origin===self.location.origin);
    return existing?existing.focus():self.clients.openWindow('/');
  }));
});
