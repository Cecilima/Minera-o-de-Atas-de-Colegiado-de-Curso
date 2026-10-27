// Envia um PDF pela interface, como um usuário faria (extração com pdf.js no navegador).
// Uso: node tests/browser-pdf.js <ata.pdf> <pasta do pdfjs-dist@3.11.174/build>
//   (o pdf.js é servido localmente no lugar da CDN — útil em ambientes sem acesso à internet)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const PDF = process.argv[2], PDFJS = process.argv[3];
if (!PDF || !PDFJS) { console.log('uso: node tests/browser-pdf.js <ata.pdf> <pdfjs-dist/build>'); process.exit(0); }
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/.*\/pdf\.min\.js/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(PDFJS, 'pdf.min.js')) }));
  await p.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/.*\/pdf\.worker\.min\.js/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(PDFJS, 'pdf.worker.min.js')) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.setViewportSize({ width: 1360, height: 900 });
  await p.goto('file://' + root + '/index.html', { waitUntil: 'load' });
  await p.setInputFiles('#file-input', [PDF]);
  await p.waitForFunction(() => document.querySelectorAll('#ata-tbody tr:not(.pending):not(.empty-row)').length >= 1, null, { timeout: 30000 });
  const stored = await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('arquivo-atas-colegiado:v1'))[0]; return { len: a.textExcerpt.length, pages: (a.textExcerpt.match(/\f/g) || []).length, reuniao: a.reuniao, an: a.analysis }; });
  console.log('texto guardado:', stored.len, 'chars |', stored.pages, 'marcas de página | reunião:', stored.reuniao);
  const an = stored.an;
  console.log('assuntos:', JSON.stringify(an.assuntosDetalhe.map(x => [x.titulo, x.subtopicos || []])));
  console.log('decisões:', an.decisoes.map(d => d.descricao.slice(0, 70) + ' [' + d.confianca + ']'));
  console.log('encaminhamentos:', an.encaminhamentos.map(d => d.descricao.slice(0, 70) + ' [' + d.confianca + ']'));
  console.log('demandas:', an.demandas.map(d => d.descricao.slice(0, 70) + ' [' + d.situacao + ']'));
  console.log('problemas:', an.problemas.map(d => d.descricao.slice(0, 70)));
  console.log('sugestões:', an.sugestoes.length, '| participantes:', an.participantes.length, '| presença:', an.presenca && [an.presenca.presentes.length, an.presenca.ausentes.length, an.presenca.justificadas.length]);
  console.log('termos:', an.termosRecorrentes.map(t => t.termo).join(', '));
  await p.evaluate(() => document.querySelector('#ata-tbody tr').click());
  await new Promise(r => setTimeout(r, 400));
    await p.evaluate(() => document.querySelector('.dh-actions [data-open-reader]').click());
  await new Promise(r => setTimeout(r, 400));
    await p.evaluate(() => { const s = document.getElementById('reader-scroll'); s.scrollTop = s.scrollHeight - 1700; });
  await new Promise(r => setTimeout(r, 300));
    await p.evaluate(() => document.querySelector('.rb-seg [data-mode="orig"]').click());
  await new Promise(r => setTimeout(r, 300));
  const origOk = await p.evaluate(a => document.querySelector('#reader-orig pre').textContent.length, null);
  console.log('original exibido:', origOk, 'chars (guardado', stored.len, '− marcas de página)');
    console.log('ERROS JS:', errs.length ? errs : 'nenhum');
  await b.close();
})();
