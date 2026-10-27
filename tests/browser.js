const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');
(async()=>{
  const root = path.resolve(__dirname,'..');
  const b = await chromium.launch({args:['--no-sandbox']});
  const p = await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await p.setViewportSize({width:1360,height:900});
  await p.goto('file://'+root+'/index.html',{waitUntil:'domcontentloaded'});
  await p.setInputFiles('#file-input', ['ata1-numerada.txt','ata2-corrido.txt','ata3-titulos-tabela.txt'].map(f=>path.join(__dirname,'atas',f)));
  await new Promise(r=>setTimeout(r,1200));
  // layout lado a lado?
  const lay = await p.evaluate(()=>{ const u=document.querySelector('.col-upload').getBoundingClientRect(), i=document.querySelector('.col-index').getBoundingClientRect(); return {upload:[Math.round(u.left),Math.round(u.top),Math.round(u.width)], index:[Math.round(i.left),Math.round(i.top),Math.round(i.width)], statusFilter: !!document.getElementById('status-filter'), rows: document.querySelectorAll('#ata-tbody tr').length}; });
  console.log('LAYOUT',JSON.stringify(lay));
  await p.screenshot({path:'/tmp/shot-arquivo.png'});
  // mobile
  await p.setViewportSize({width:420,height:900}); await new Promise(r=>setTimeout(r,200));
  const lay2 = await p.evaluate(()=>{ const u=document.querySelector('.col-upload').getBoundingClientRect(), i=document.querySelector('.col-index').getBoundingClientRect(); return {uploadTop:Math.round(u.top), indexTop:Math.round(i.top), sameColumn: Math.abs(u.left-i.left)<2}; });
  console.log('MOBILE',JSON.stringify(lay2));
  await p.setViewportSize({width:1360,height:900});
  // abrir detalhe da ata1
  await p.evaluate(()=>{ [...document.querySelectorAll('#ata-tbody tr')].find(tr=>tr.textContent.includes('ata1')).click(); });
  await new Promise(r=>setTimeout(r,500));
  await p.screenshot({path:'/tmp/shot-drawer.png'});
  await p.evaluate(()=>document.getElementById('drawer').scrollTo(0,99999));
  // dashboard
  await p.evaluate(()=>{ document.getElementById('drawer-backdrop').click(); document.querySelector('[data-view=painel]').click(); });
  await new Promise(r=>setTimeout(r,500)); await p.screenshot({path:'/tmp/shot-painel.png',fullPage:true});
  // responsáveis
  await p.evaluate(()=>document.querySelector('[data-view=responsaveis]').click());
  await new Promise(r=>setTimeout(r,300));
  console.log('RESP', await p.evaluate(()=>[...document.querySelectorAll('.resp-name')].map(e=>e.textContent).join(' | ')));
  // consulta
  await p.evaluate(()=>document.querySelector('[data-view=consulta]').click());
  for(const q of ['quais encaminhamentos ainda não têm prazo definido?','Quais prazos vencem em breve?','Resuma os principais assuntos','Quais problemas foram relatados com mais frequência?']){
    await p.evaluate(q=>{ document.getElementById('chat-input').value=q; document.getElementById('chat-send').click(); },q);
    await new Promise(r=>setTimeout(r,150));
  }
  console.log('CHAT', await p.evaluate(()=>[...document.querySelectorAll('.msg.assistant')].map(m=>m.textContent.slice(0,330)).join('\n-----\n')));
  console.log('ERRORS', errs.length? errs.join('\n'):'nenhum');
  await b.close();
})();
