/* ============================================================
   LEITURA DE PDF  (js/pdftext.js)
   ------------------------------------------------------------
   Roda inteiramente no navegador (GitHub Pages, sem servidor).
   Também roda no Node para testes (recebe o pdfjsLib como parâmetro).

   Devolve:
     text    — texto com as linhas reconstruídas pela posição; "\f" separa páginas
               e uma linha em branco marca um PARÁGRAFO REAL (espaço vertical maior);
     layout  — pistas de formatação, sem alterar o texto:
                 destaques: linhas curtas em negrito ou com fonte maior que o corpo
                            (prováveis títulos/cabeçalhos);
                 enfase:    trechos do corpo inteiramente em negrito/itálico
                            (atas costumam destacar deliberações assim);
     ocr     — páginas cujo texto veio de OCR (PDF digitalizado).

   OCR: só para páginas SEM camada de texto; o Tesseract.js é carregado sob demanda
   (a primeira vez baixa ~4 MB de programa + ~1,4 MB do idioma português, depois fica em cache).
============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtaPdf = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// versões fixas (CDN) — trocar aqui para atualizar
const TESSERACT = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int'
};
const MIN_PAGE_CHARS = 25;          // menos que isso (sem espaços) = página sem texto → candidata a OCR
const RE_BOLD = /bold|black|heavy|semibold|demibold|extrabold|ultrabold|\bbd\b|-bd\b|,bold/i;
const RE_ITALIC = /italic|oblique|\bit\b|-it\b|,italic/i;

function fontStyle(page, item, styles) {
  let name = '', bold = false, italic = false;
  try {
    const f = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
    if (f) { name = f.name || ''; bold = !!f.bold || RE_BOLD.test(name); italic = !!f.italic || RE_ITALIC.test(name); }
  } catch (e) { /* fonte indisponível: segue sem estilo */ }
  if (!name && styles && styles[item.fontName]) {
    const fam = styles[item.fontName].fontFamily || '';
    bold = RE_BOLD.test(fam); italic = RE_ITALIC.test(fam);
  }
  return { bold, italic };
}

/* Entrelinha típica de uma página = o MENOR espaçamento que se repete (arredondado a 0,5 pt).
   A mediana não serve: numa ata curta, com muitos parágrafos, os próprios espaços entre
   parágrafos inflam a mediana e escondem as quebras. */
function typicalGap(gaps) {
  const cnt = new Map();
  gaps.forEach(g => { const k = Math.round(g * 2) / 2; cnt.set(k, (cnt.get(k) || 0) + 1); });
  const rep = Array.from(cnt).filter(([, c]) => c >= 2).map(([k]) => k).sort((a, b) => a - b);
  if (rep.length) return rep[0];
  const a = gaps.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length * 0.25)] : 0;
}
const median = arr => { const a = arr.filter(x => x > 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

/* Reconstrói as linhas de uma página a partir dos trechos do pdf.js.
   Sobrescritos ("profª", "1º") têm altura menor e ficam deslocados: não abrem linha nova. */
function pageLines(items, page, styles) {
  const lines = [];
  let cur = null, lastEnd = null;
  const close = () => { if (cur) { cur.text = cur.text.replace(/\s+$/, ''); lines.push(cur); } cur = null; lastEnd = null; };
  items.forEach(it => {
    if (!it.str && !it.hasEOL) return;
    const y = it.transform[5], x = it.transform[4], h = it.height || 10;
    if (cur && Math.abs(y - cur.y) > Math.max(h, cur.h) * 0.6) close();
    if (!cur) cur = { text: '', y, h: 0, x, runs: 0, boldChars: 0, italicChars: 0, chars: 0 };
    if (lastEnd !== null && cur.text) {
      const gap = x - lastEnd, sup = cur.h && h < cur.h * 0.85 && gap < cur.h * 0.15;
      cur.text += gap > Math.max(h, cur.h) * 3 ? '\t' : (sup || /\s$/.test(cur.text) || /^\s/.test(it.str) ? '' : ' ');
    }
    if (it.str.trim()) {
      if (h >= cur.h * 0.85 && !cur.text.trim()) { cur.y = y; cur.x = x; }
      cur.h = Math.max(cur.h, h);
      const st = fontStyle(page, it, styles), n = it.str.replace(/\s/g, '').length;
      cur.chars += n; if (st.bold) cur.boldChars += n; if (st.italic) cur.italicChars += n;
    }
    cur.text += it.str;
    lastEnd = x + (it.width || 0);
  });
  close();
  return lines.filter(l => l.text.trim());
}

async function loadTesseract(onProgress) {
  if (typeof self !== 'undefined' && self.Tesseract) return self.Tesseract;
  if (typeof document === 'undefined') throw new Error('OCR disponível apenas no navegador');
  onProgress && onProgress({ fase: 'ocr-carregando' });
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = TESSERACT.script; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('não foi possível carregar o OCR (sem conexão?)'));
    document.head.appendChild(s);
  });
  return self.Tesseract;
}

async function ocrPage(page, worker) {
  const viewport = page.getViewport({ scale: 2.2 });          // ~200 dpi: bom equilíbrio entre precisão e tempo
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const { data } = await worker.recognize(canvas);
  canvas.width = canvas.height = 0;
  return { text: data.text || '', confidence: data.confidence };
}

/* opts: { maxPages, ocr: true|false, onProgress(evt) } */
async function extract(pdfjsLib, data, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress || null;
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const maxPages = Math.min(pdf.numPages, opts.maxPages || 80);
  const pages = [];
  const allLines = [];
  for (let i = 1; i <= maxPages; i++) {
    onProgress && onProgress({ fase: 'texto', pagina: i, total: maxPages });
    const page = await pdf.getPage(i);
    try { await page.getOperatorList(); } catch (e) { /* sem acesso às fontes: segue sem estilo */ }
    const tc = await page.getTextContent();
    const lines = pageLines(tc.items, page, tc.styles);
    const chars = lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0);
    pages.push({ page, lines, chars });
    lines.forEach(l => allLines.push(l));
  }

  // ---- corpo do texto: tamanho de fonte e espaçamento típicos ----
  const bodySize = median(allLines.map(l => l.h));

  // ---- OCR nas páginas sem texto ----
  const ocrPages = [];
  const needOcr = pages.map((p, k) => p.chars < MIN_PAGE_CHARS ? k : -1).filter(k => k >= 0);
  let ocrErro = null;
  if (needOcr.length && opts.ocr !== false && typeof document !== 'undefined') {
    let Tesseract = null;
    try { Tesseract = await loadTesseract(onProgress); }
    catch (e) { ocrErro = e.message || String(e); }
    if (Tesseract) {
    let current = 0;
    const worker = await Tesseract.createWorker('por', 1, {
      workerPath: TESSERACT.workerPath, corePath: TESSERACT.corePath, langPath: TESSERACT.langPath,
      logger: m => { if (onProgress && m && m.status === 'recognizing text') onProgress({ fase: 'ocr', pagina: needOcr[current] + 1, total: maxPages, progresso: m.progress, paginasOcr: needOcr.length, atual: current + 1 }); }
    });
    try {
      for (current = 0; current < needOcr.length; current++) {
        const k = needOcr[current];
        onProgress && onProgress({ fase: 'ocr', pagina: k + 1, total: maxPages, progresso: 0, paginasOcr: needOcr.length, atual: current + 1 });
        const r = await ocrPage(pages[k].page, worker);
        pages[k].ocrText = r.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        ocrPages.push({ pagina: k + 1, confianca: Math.round(r.confidence || 0) });
      }
    } finally { await worker.terminate(); }
    }
  }

  // ---- monta o texto ----
  const destaques = [], enfase = [];
  let text = '';
  pages.forEach((p, k) => {
    if (p.ocrText != null) { text += p.ocrText + '\n'; if (k < pages.length - 1) text += '\f'; return; }
    const gaps = [];
    for (let j = 1; j < p.lines.length; j++) { const g = p.lines[j - 1].y - p.lines[j].y; if (g > 0) gaps.push(g); }
    const lineGap = typicalGap(gaps);
    let run = [];
    const flushRun = () => { if (run.length) { enfase.push(run.join(' ')); run = []; } };
    p.lines.forEach((l, j) => {
      // parágrafo real: espaço vertical claramente maior que o entrelinhas da página
      if (j > 0 && lineGap) { const g = p.lines[j - 1].y - l.y; if (g > lineGap * 1.45 && g < lineGap * 6) text += '\n'; }
      text += l.text + '\n';
      const t = l.text.trim();
      const bold = l.chars && l.boldChars / l.chars >= 0.9, italic = l.chars && l.italicChars / l.chars >= 0.9;
      const bigger = bodySize && l.h >= bodySize * 1.15;
      if (t.length <= 140 && (bold || bigger)) destaques.push({ texto: t, motivo: bigger ? 'fonte maior' : 'negrito' });
      if ((bold || italic) && !bigger) run.push(t); else flushRun();
    });
    flushRun();
    if (k < pages.length - 1) text += '\f';
  });
  // ênfase só vale se for EXCEÇÃO: se quase todo o corpo está em negrito/itálico, é o estilo base
  const bodyChars = allLines.reduce((n, l) => n + l.chars, 0);
  const emphChars = allLines.reduce((n, l) => n + ((l.boldChars + l.italicChars) / Math.max(1, l.chars) >= 0.9 && !(bodySize && l.h >= bodySize * 1.15) ? l.chars : 0), 0);
  const enfaseValida = bodyChars && emphChars / bodyChars <= 0.4;

  return {
    text,
    paginas: pdf.numPages, lidas: maxPages,
    layout: { destaques: destaques.slice(0, 400), enfase: enfaseValida ? enfase.slice(0, 200) : [] },
    ocr: ocrPages,
    semTexto: needOcr.filter(k => pages[k].ocrText == null).map(k => k + 1),   // páginas que ficaram sem texto
    ...(ocrErro ? { ocrErro } : {})
  };
}

return { extract, TESSERACT, MIN_PAGE_CHARS };
}));
