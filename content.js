(() => {
  console.log('[token-saver-he v4.0.0] light & draggable');
  const HEB_RE = /[\u0590-\u05FF]/g;
  const isHebrew = t => t && t.length>3 && (t.match(HEB_RE)||[]).length / t.length > 0.22;
  
  let enabled = true;
  let pos = { top: 20, right: 20 }; // default
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let hasDragged = false;

  chrome.storage.local.get(['enabled','bubblePos']).then(s=>{
    if(s.enabled===false) enabled=false;
    if(s.bubblePos) pos = s.bubblePos;
    injectBubble();
  });
  chrome.storage.onChanged.addListener(c=>{
    if(c.enabled) { enabled=c.enabled.newValue!==false; updateBubble(); }
  });

  function injectBubble(){
    if(document.getElementById('he-en-bubble')) return;
    const b = document.createElement('div');
    b.id='he-en-bubble';
    b.innerHTML = `
      <span id="he-en-bubble-icon">HE</span>
      <div id="he-en-bubble-dot"></div>
      <div id="he-en-bubble-tooltip">לחץ להפעלה/כיבוי • גרור להזזה</div>
    `;
    // Apply saved position
    if(pos.top!==undefined) b.style.top = pos.top + 'px';
    if(pos.left!==undefined) { b.style.left = pos.left + 'px'; b.style.right='auto'; }
    else if(pos.right!==undefined) { b.style.right = pos.right + 'px'; b.style.top = pos.top + 'px'; }
    
    document.body.appendChild(b);
    updateBubble();
    makeDraggable(b);
  }

  function updateBubble(){
    const el=document.getElementById('he-en-bubble');
    if(!el) return;
    el.className = enabled ? 'he-en-on' : 'he-en-off';
    const dot=document.getElementById('he-en-bubble-dot');
    const tip=document.getElementById('he-en-bubble-tooltip');
    if(tip) tip.textContent = enabled ? 'פעיל • לחץ לכיבוי • גרור להזזה' : 'כבוי • לחץ להפעלה • גרור להזזה';
  }

  function makeDraggable(el){
    let startX, startY, initialLeft, initialTop;

    el.addEventListener('mousedown', (e)=>{
      isDragging = true;
      hasDragged = false;
      const rect = el.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
      el.style.transition = 'none';
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e)=>{
      if(!isDragging) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if(dx > 3 || dy > 3) hasDragged = true;
      
      let newLeft = e.clientX - dragOffset.x;
      let newTop = e.clientY - dragOffset.y;
      
      // Keep inside viewport
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 44));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - 44));
      
      el.style.left = newLeft + 'px';
      el.style.top = newTop + 'px';
      el.style.right = 'auto';
    });

    document.addEventListener('mouseup', async ()=>{
      if(!isDragging) return;
      isDragging = false;
      el.style.transition = '';
      el.style.cursor = 'grab';
      
      if(hasDragged){
        // Save position
        const rect = el.getBoundingClientRect();
        pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
        await chrome.storage.local.set({ bubblePos: pos });
        // Prevent click after drag
        setTimeout(()=>{ hasDragged=false; }, 100);
      } else {
        // It was a click - toggle
        const s=await chrome.storage.local.get(['enabled']);
        const ne = s.enabled===false ? true : false;
        await chrome.storage.local.set({enabled: ne});
      }
    });

    // Touch support for mobile
    el.addEventListener('touchstart', (e)=>{
      const touch = e.touches[0];
      isDragging = true;
      hasDragged = false;
      const rect = el.getBoundingClientRect();
      dragOffset.x = touch.clientX - rect.left;
      dragOffset.y = touch.clientY - rect.top;
      startX = touch.clientX;
      startY = touch.clientY;
      el.style.transition = 'none';
    }, {passive:false});

    document.addEventListener('touchmove', (e)=>{
      if(!isDragging) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
      if(dx > 3 || dy > 3) hasDragged = true;
      let newLeft = touch.clientX - dragOffset.x;
      let newTop = touch.clientY - dragOffset.y;
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 44));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - 44));
      el.style.left = newLeft + 'px';
      el.style.top = newTop + 'px';
      el.style.right = 'auto';
      e.preventDefault();
    }, {passive:false});

    document.addEventListener('touchend', async ()=>{
      if(!isDragging) return;
      isDragging = false;
      el.style.transition = '';
      if(hasDragged){
        const rect = el.getBoundingClientRect();
        pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
        await chrome.storage.local.set({ bubblePos: pos });
        setTimeout(()=>{ hasDragged=false; }, 100);
      }
    });
  }

  // Translation logic (0 tokens extra)
  function protect(text){
    const store=[]; let i=0;
    text=text.replace(/```[\s\S]*?```/g,m=>{ const ph=`__CB_${i}__`; store.push({ph,val:m}); i++; return ph; });
    text=text.replace(/`[^`\n]+`/g,m=>{ const ph=`__CI_${i}__`; store.push({ph,val:m}); i++; return ph; });
    text=text.replace(/https?:\/\/\S+/g,m=>{ const ph=`__URL_${i}__`; store.push({ph,val:m}); i++; return ph; });
    return {text,store};
  }
  function restore(text,store){ for(const {ph,val} of store) text=text.replaceAll(ph,val); return text; }
  async function translateFree(text){
    const chunks=[]; for(let j=0;j<text.length;j+=800) chunks.push(text.slice(j,j+800));
    let full=''; for(const ch of chunks){
      const url=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(ch)}`;
      const r=await fetch(url); const d=await r.json(); full+=d[0].map(x=>x[0]).join(''); await new Promise(r=>setTimeout(r,40));
    } return full;
  }
  function findInput(){
    let el=document.querySelector('div[contenteditable="true"][data-placeholder]'); if(el) return el;
    el=document.querySelector('div[contenteditable="true"]'); if(el) return el;
    el=document.querySelector('#prompt-textarea'); if(el) return el;
    return document.querySelector('textarea');
  }

  let busy=false;
  document.addEventListener('keydown', async e=>{
    if(busy||!enabled||e.key!=='Enter'||e.shiftKey||e.isComposing) return;
    const input=findInput(); if(!input) return;
    let txt=input.tagName==='TEXTAREA'?input.value:(input.innerText||'');
    if(!txt.trim()||!isHebrew(txt)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); busy=true;
    try{
      const {text:prot,store}=protect(txt);
      const trans=await translateFree(prot);
      const finalEn=restore(trans,store);
      if(input.tagName==='TEXTAREA'){ input.value=finalEn; input.dispatchEvent(new Event('input',{bubbles:true})); }
      else{ input.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,finalEn); input.dispatchEvent(new InputEvent('input',{bubbles:true})); }
      setTimeout(()=>{ busy=false; const ev=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}); input.dispatchEvent(ev); const btn=document.querySelector('button[aria-label*="Send"]')||document.querySelector('[data-testid="send-button"]'); if(btn) btn.click(); },100);
    }catch(err){ console.error(err); busy=false; }
  }, true);
})();
