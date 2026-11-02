(() => {
  console.log('[token-saver-he v4.0.2] light & draggable');
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
      const r=await fetch(url);
      if(!r.ok) throw new Error(`Translation failed: ${r.status}`);
      const d=await r.json(); full+=d[0].map(x=>x[0]).join(''); await new Promise(r=>setTimeout(r,40));
    } return full;
  }
  function findInput(root=document){
    for(const selector of ['#prompt-textarea', 'div[contenteditable="true"][data-placeholder]', 'div[contenteditable="true"]', 'textarea']){
      const input=Array.from(root.querySelectorAll(selector)).find(el=>el.getClientRects().length && !el.disabled && !el.readOnly);
      if(input) return input;
    }
    return null;
  }

  let busy=false;
  let sending=false;
  const readInput=input=>input.tagName==='TEXTAREA'?input.value:(input.innerText||'');

  function stopSubmission(event){
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function isSendButton(button,input){
    if(button.disabled || button.getAttribute('aria-disabled')==='true') return false;
    if(button.matches('[data-testid="send-button"]')) return true;
    const label=(button.getAttribute('aria-label')||button.getAttribute('title')||'').trim();
    const actionLabel=label.split(/\s*[\[(]/,1)[0].trim();
    if(/^(send(?: message| prompt)?|שליחה|שלח|שליחת הודעה|שלח הודעה)$/i.test(actionLabel)) return true;
    const form=input.closest('form');
    return !!form && button.form===form && button.type==='submit';
  }

  function findSendButton(input){
    // Prefer the nearest composer, so another chat or feedback form cannot be sent.
    const form=input.closest('form');
    for(let root=input.parentElement; root; root=root.parentElement){
      const button=Array.from(root.querySelectorAll('button,input[type="submit"],[role="button"]'))
        .find(el=>el.getClientRects().length && isSendButton(el,input));
      if(button) return button;
      if(root===form) break;
    }
    return null;
  }

  function findButtonInput(button){
    const form=button.closest('form');
    if(form) return findInput(form);
    for(let root=button.parentElement; root; root=root.parentElement){
      const input=findInput(root);
      if(input) return input;
    }
    return null;
  }

  function writeInput(input,text){
    if(input.tagName==='TEXTAREA'){
      // Bypass a framework's value tracker, then notify its input handler.
      const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setter.call(input,text);
    } else {
      input.focus();
      document.execCommand('selectAll',false,null);
      document.execCommand('insertText',false,text);
    }
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
  }

  async function translateAndSend(event,input,clickedButton=null){
    if(sending || !enabled) return;
    if(busy){ stopSubmission(event); return; }
    const original=readInput(input);
    if(!original.trim() || !isHebrew(original)) return;
    stopSubmission(event);
    busy=true;
    try{
      const {text:prot,store}=protect(original);
      const trans=await translateFree(prot);
      const finalEn=restore(trans,store);
      // Do not overwrite a draft edited while the translation was in flight.
      if(!input.isConnected || readInput(input)!==original || !enabled) return;
      writeInput(input,finalEn);
      await new Promise(resolve=>setTimeout(resolve,100));
      if(!input.isConnected || readInput(input)!==finalEn || !enabled) return;
      const button=clickedButton?.isConnected && isSendButton(clickedButton,input)
        ? clickedButton : findSendButton(input);
      sending=true;
      if(button){
        button.click();
      } else if(input.closest('form')){
        input.closest('form').requestSubmit();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true,cancelable:true}));
      }
    }catch(err){ console.error(err); }
    finally { sending=false; busy=false; }
  }

  // Capture before the site's composer handlers, including handlers on document.
  window.addEventListener('keydown',e=>{
    if(!(e.target instanceof Element) || e.key!=='Enter' || e.shiftKey || e.isComposing) return;
    const input=findInput(e.target.closest('form')||document);
    if(!input || !input.contains(e.target)) return;
    void translateAndSend(e,input);
  },true);

  window.addEventListener('click',e=>{
    if(!(e.target instanceof Element)) return;
    const button=e.target.closest('button,input[type="submit"],[role="button"]');
    if(!button) return;
    const input=findButtonInput(button);
    if(!input || !isSendButton(button,input)) return;
    void translateAndSend(e,input,button);
  },true);

  window.addEventListener('submit',e=>{
    const input=findInput(e.target);
    if(input) void translateAndSend(e,input,e.submitter);
  }, true);
})();
