const $=id=>document.getElementById(id);
chrome.storage.local.get(['enabled']).then(s=>{ const en=s.enabled!==false; document.body.innerHTML+='<p style="font-size:11px;color:#888">'+(en?'בועה פעילה':'כבויה')+'</p>'; });
