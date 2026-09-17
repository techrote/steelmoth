'use strict';
(() => {
  const localPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const secureEnough = location.protocol === 'https:' || localPreview;

  async function clearLocalPreviewCaches(){
    if(!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    try{
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }catch(err){ console.warn('Local service-worker unregister failed:', err); }
    try{
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('small-machine-web-')).map(k => caches.delete(k)));
      }
    }catch(err){ console.warn('Local cache cleanup failed:', err); }
    if(hadController && !sessionStorage.getItem('steel-moth-local-sw-cleared-v123')){
      sessionStorage.setItem('steel-moth-local-sw-cleared-v123','1');
      location.reload();
    }
  }

  if(localPreview){
    window.addEventListener('load', clearLocalPreviewCaches, {once:true});
    return;
  }

  if('serviceWorker' in navigator && secureEnough){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=1.2.3', {scope:'./', updateViaCache:'none'}).catch(err => {
        console.warn('Offline cache unavailable:', err);
      });
    }, {once:true});
  }
})();
