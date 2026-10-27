// OCR no navegador: envia um PDF só de imagem (ata9) pela interface.
// pdf.js e Tesseract.js são servidos localmente no lugar das CDNs (útil sem internet).
// Uso: node tests/browser-ocr.js <pdfjs-dist@3.11.174/build> <pasta com tesseract.js-5.1.1, tesseract.js-core-5.1.1, tesseract.js-data-por-1.0.0>
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const [PDFJS, TESS] = process.argv.slice(2);
if (!PDFJS || !TESS) { console.log('uso: node tests/browser-ocr.js <pdfjs build> <pasta tesseract>'); process.exit(0); }
const serve = (route, file, type) => route.fulfill({ contentType: type, body: fs.readFileSync(file) });
const typeOf = f => /\.wasm$/.test(f) ? 'application/wasm' : (/\.gz$/.test(f) ? 'application/gzip' : 'application/javascript');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await b.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/[^/]+\/(pdf(?:\.worker)?\.min\.js)/, r => serve(r, path.join(PDFJS, r.request().url().match(/(pdf(?:\.worker)?\.min\.js)/)[1]), 'application/javascript'));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/tesseract\.js@5\.1\.1\/dist\/([^?]+)/, r => { const f = r.request().url().match(/dist\/([^?]+)/)[1]; serve(r, path.join(TESS, 'tesseract.js-5.1.1/package/dist', f), typeOf(f)); });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/tesseract\.js-core@5\.1\.1\/([^?]+)/, r => { const f = r.request().url().match(/core@5\.1\.1\/([^?]+)/)[1]; serve(r, path.join(TESS, 'tesseract.js-core-5.1.1/package', f), typeOf(f)); });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@tesseract\.js-data\/por@1\.0\.0\/4\.0\.0_best_int\/([^?]+)/, r => { const f = r.request().url().match(/best_int\/([^?]+)/)[1]; serve(r, path.join(TESS, 'tesseract.js-data-por-1.0.0/package/4.0.0_best_int', f), typeOf(f)); });
  const p = await ctx.newPage(); const errs = [], prog = new Set();
  p.on('pageerror', e => errs.push(e.message));
  await p.setViewportSize({ width: 1360, height: 900 });
  await p.goto('file://' + root + '/index.html', { waitUntil: 'load' });
  const t0 = Date.now();
  await p.setInputFiles('#file-input', [path.join(__dirname, 'atas', 'ata9-digitalizada.pdf')]);
  const poll = setInterval(async () => { try { const m = await p.evaluate(() => (document.querySelector('#ata-tbody tr.pending .processing-flag') || {}).textContent || ''); if (m) prog.add(m.replace(/\d+%/, 'N%').trim()); } catch (e) {} }, 300);
  await p.waitForFunction(() => document.querySelectorAll('#ata-tbody tr:not(.pending):not(.empty-row)').length >= 1, null, { timeout: 180000 });
  clearInterval(poll);
  const a = await p.evaluate(() => JSON.parse(localStorage.getItem('arquivo-atas-colegiado:v1'))[0]);
  console.log('tempo:', ((Date.now() - t0) / 1000).toFixed(1) + 's | páginas OCR:', JSON.stringify(a.ocr));
  console.log('mensagens de progresso:', [...prog].join(' | '));
  const an = a.analysis;
  const checks = {
    'texto reconhecido por OCR': a.ocr.length === 2 && a.textExcerpt.length > 600,
    'assuntos I e II reconhecidos': an.assuntos.length === 2 && /formaturas/i.test(an.assuntos[0]) && /equipamentos/i.test(an.assuntos[1]),
    'decisão encontrada': an.decisoes.some(d => /aprovada por unanimidade/.test(d.descricao)),
    'encaminhamento com prazo': an.encaminhamentos.some(e => /30\/06\/2025/.test(e.prazo || '')),
    'confiança registra o OCR': an.decisoes.concat(an.encaminhamentos).every(x => (x.evidencias || []).some(e => /OCR/.test(e.texto))),
    'aviso de OCR na análise': (an.avisos || []).some(x => /OCR/.test(x)),
    'cabeçalho/rodapé repetidos removidos': (an.assuntos.join(' ') + an.decisoes.map(d => d.descricao).join(' ')).indexOf('Conselho do Campus –') < 0,
    'data por extenso reconhecida ("Aos dois dias…")': a.data === '2025-06-02' && a.dataOrigem === 'texto',
    'romanos lidos com erro de OCR ("1I") reconhecidos': an.estrutura.tipo === 'numerada',
    'reunião identificada no texto do OCR': a.reuniao === 'Ata nº 4/2025 — Conselho do Campus Itapoá',
    'marca OCR na tabela': await p.evaluate(() => !!document.querySelector('#ata-tbody .sec-tag.ocr'))
  };
  console.log('assuntos:', JSON.stringify(an.assuntos), '| data:', a.data, a.dataOrigem);
  console.log('decisões:', an.decisoes.map(d => d.descricao + ' [' + d.confianca + ']'));
  console.log('encaminhamentos:', an.encaminhamentos.map(d => d.descricao + ' | prazo=' + d.prazo));
  console.log(JSON.stringify(checks, null, 1));
  console.log('ERROS JS:', errs.length ? errs : 'nenhum');
  await p.evaluate(() => document.querySelector('#ata-tbody tr').click()); await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await b.close();
  process.exitCode = Object.values(checks).every(Boolean) && !errs.length ? 0 : 1;
})();
