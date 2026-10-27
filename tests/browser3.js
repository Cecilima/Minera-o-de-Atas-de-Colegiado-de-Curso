// Interface: título do assunto × metadados; tipos de responsável; prazo × contexto.
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setViewportSize({ width: 1360, height: 900 });
  await p.goto('file://' + root + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.setInputFiles('#file-input', [path.join(__dirname, 'atas', 'ata5-pdf-quebras.txt')]);
  await new Promise(r => setTimeout(r, 900));
  await p.evaluate(() => document.querySelector('#ata-tbody tr').click());
  await new Promise(r => setTimeout(r, 400));
  // simula "selecionar a lista de assuntos e copiar"
  const copied = await p.evaluate(() => {
    const ul = document.querySelector('.subj-list'); const sel = getSelection(); const rg = document.createRange();
    rg.selectNodeContents(ul); sel.removeAllRanges(); sel.addRange(rg); return sel.toString();
  });
  const titles = await p.evaluate(() => [...document.querySelectorAll('.subj-title')].map(e => e.textContent));
  const txt = await p.evaluate(() => document.getElementById('drawer').innerText);
  const checks = {
    'títulos sem termos de controle': titles.every(t => !/numera|confian|origem/i.test(t)),
    'cópia da lista sem metadados': !/numera[cç][aã]o|confian[cç]a|origem:/i.test(copied),
    'título quebrado completo na tela': titles.includes('Indicação do novo representante discente no colegiado do curso (relatoria Coordenação do curso)'),
    'responsável com tipo exibido': await p.evaluate(()=>[...document.querySelectorAll('.tag .meta')].map(e=>getComputedStyle(e,'::before').content).join('|')).then(x=>/papel genérico/.test(x)&&/órgão/.test(x)),
    'solicitante exibido': /solicitado por: Relator/.test(txt),
  };
  // leitor do texto
  await p.evaluate(() => document.querySelector('.dh-actions [data-open-reader]').click());
  await new Promise(r => setTimeout(r, 400));
  const rd = await p.evaluate(() => ({ open: document.getElementById('reader').classList.contains('open'),
    secs: document.querySelectorAll('#reader-doc .r-sec').length, paras: document.querySelectorAll('#reader-doc .r-p').length,
    toc: document.querySelectorAll('.reader-toc a').length, indent: getComputedStyle(document.querySelector('#reader-doc .r-p')).textIndent }));
  await p.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 300));
  checks['leitor abre com seções, sumário e parágrafos recuados'] = rd.open && rd.secs === 5 && rd.toc === 5 && rd.paras >= 8 && rd.indent !== '0px';
  checks['Esc fecha o leitor e volta à gaveta'] = await p.evaluate(() => !document.getElementById('reader').classList.contains('open') && document.getElementById('drawer').classList.contains('open'));
  checks['sem botão de exportar JSON'] = await p.evaluate(() => !document.getElementById('export-btn') && !/Exportar JSON/.test(document.body.innerText));
  checks['faixa de seção separa o hero do arquivo'] = await p.evaluate(() => { const h = document.querySelector('.hero').getBoundingClientRect(), r = document.querySelector('.section-rule').getBoundingClientRect(); return r.top - h.bottom >= 24; });
  // nível de confiança na interface (seção 10)
  checks['nível de confiança compacto ("● Alta/Média/Baixa") em cada item'] = await p.evaluate(() => { const c = [...document.querySelectorAll('#drawer .item-card button.conf')]; return c.length > 0 && c.every(b => /^(Alta|Média|Baixa)/.test(b.textContent.trim()) && b.querySelector('.dot')); });
  checks['clicar no nível mostra explicação específica + evidências'] = await p.evaluate(() => { const b = document.querySelector('#drawer .item-card button.conf'); b.click(); const pop = document.getElementById(b.getAttribute('aria-controls')); return !pop.hidden && /confiança:/.test(pop.innerText) && /representa (uma|um)/.test(pop.innerText) && pop.querySelectorAll('.cp-ev li').length > 0 && b.getAttribute('aria-expanded') === 'true'; });
  checks['ajuda geral acessível pelo "?" do cabeçalho e pela gaveta'] = await p.evaluate(() => !!document.getElementById('help-btn') && !!document.querySelector('#drawer [data-conf-help]'));
  await p.evaluate(() => document.querySelector('#drawer [data-conf-help]').click()); await new Promise(r => setTimeout(r, 200));
  checks['ajuda explica que confiança ≠ importância/confiabilidade da ata'] = await p.evaluate(() => { const d = document.getElementById('conf-help'); return d.classList.contains('open') && /não indica a importância da informação nem a confiabilidade da ata/.test(d.innerText); });
  await p.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 200));
  console.log(JSON.stringify(checks, null, 1));
  console.log('CÓPIA:\n' + copied);
  console.log('ERROS JS:', errs.length ? errs : 'nenhum');
  await p.screenshot({ path: path.join(__dirname, '..', '..', 'shot-drawer5.png') });
  await b.close();
  process.exitCode = Object.values(checks).every(Boolean) && !errs.length ? 0 : 1;
})();
