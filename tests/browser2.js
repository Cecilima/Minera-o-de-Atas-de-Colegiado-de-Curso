const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');
(async()=>{
  const root = path.resolve(__dirname,'..');
  const b = await chromium.launch({args:['--no-sandbox']});
  const p = await b.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  await p.setViewportSize({width:1360,height:900});
  await p.goto('file://'+root+'/index.html',{waitUntil:'domcontentloaded'});
  await p.setInputFiles('#file-input',[path.join(__dirname,'atas','ata4-regressao.txt')]);
  await new Promise(r=>setTimeout(r,900));
  await p.evaluate(()=>document.querySelector('#ata-tbody tr').click());
  await new Promise(r=>setTimeout(r,400));
  const txt = await p.evaluate(()=>document.getElementById('drawer').innerText);
  const checks = {
    'Coordenação ou Direção': /Coordenação ou Direção/.test(txt),
    'responsável (alternativas)': /responsável \(alternativas\)/.test(txt),
    'Delibera a sugestão anterior': /Delibera a sugestão anterior \(deliberada\)/.test(txt),
    'Regras decorrentes': /Regras decorrentes \(parte da decisão\)/.test(txt),
    'ED2 como regra, não encaminhamento': !/ENCAM\.[\s\S]{0,200}ED2 será ofertada/.test(txt),
    'título com (2019123456)': /\(2019123456\)/.test(txt),
    'sem 2008/1 em prazos': !/prazo \/ referência: [^\n]*2008/.test(txt) && !/2023\/2\]/.test(txt),
    'proposta já deliberada informada': /já foram deliberadas/.test(txt),
    'problema "Não há possibilidade"': /PROBLEMA[\s\S]{0,120}Não há possibilidade de defesa/.test(txt),
    'sem "https" em termos': !/https/i.test(txt.split('Termos recorrentes')[1]||'')
  };
  console.log(JSON.stringify(checks,null,1)); console.log('ERROS JS:', errs.length?errs:'nenhum');
  await p.evaluate(()=>{ const d=document.getElementById('drawer'); d.scrollTo(0, 620); });
  await p.screenshot({path:'/tmp/shot-drawer4.png'});
  await b.close();
})();
