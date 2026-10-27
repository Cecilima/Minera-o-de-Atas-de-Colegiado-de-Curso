// Leitura de PDF (js/pdftext.js) no Node: layout e páginas digitalizadas.
// Requer pdfjs-dist (qualquer versão ≥ 3). Uso: PDFJS=/caminho/pdfjs-dist/legacy/build/pdf.mjs node tests/pdf.mjs
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
let pdfjsLib;
try { pdfjsLib = await import(process.env.PDFJS || 'pdfjs-dist/legacy/build/pdf.mjs'); }
catch (e) { console.log('pdfjs-dist não encontrado — teste pulado (defina PDFJS=…/pdf.mjs)'); process.exit(0); }
const AtaPdf = require('../js/pdftext.js'), E = require('../js/extractor.js');
let ok = 0, bad = 0;
const t = (nome, cond, info) => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && info !== undefined ? '\n       ↳ ' + JSON.stringify(info) : '')); };
const read = f => new Uint8Array(fs.readFileSync(path.join(here, 'atas', f)));

const r10 = await AtaPdf.extract(pdfjsLib, read('ata10-titulos-negrito.pdf'), { ocr: false });
t('ata10: texto extraído com marca de página', /Reforma da quadra/.test(r10.text) && r10.text.includes('\f'));
t('ata10: títulos em negrito detectados', ['Reforma da quadra', 'Segurança no bairro'].every(x => r10.layout.destaques.some(d => d.texto === x && d.motivo === 'negrito')), r10.layout.destaques);
t('ata10: deliberação em itálico detectada como ênfase', r10.layout.enfase.some(e => /aprovado por maioria/.test(e)), r10.layout.enfase);
t('ata10: corpo comum NÃO é ênfase', !r10.layout.enfase.some(e => /tesoureiro apresentou/.test(e)));
t('ata10: parágrafo real marcado com linha em branco', /sede\nda associação, sob a presidência do Sr\. Caio Lemos\.\n\n/.test(r10.text), r10.text.slice(0, 300));
t('ata10: nenhuma página sem texto', r10.semTexto.length === 0);
const a10 = E.extract(r10.text, { filename: 'ata10-titulos-negrito.pdf', layout: r10.layout });
t('ata10: assuntos pelo destaque, decisão no assunto certo', a10.assuntos.join('|') === 'Reforma da quadra|Segurança no bairro' && a10.decisoes[0].assunto === 'Reforma da quadra', [a10.assuntos, a10.decisoes.map(d => d.assunto)]);
t('ata10: data por extenso ("Aos doze dias … dois mil e vinte e cinco")', a10.data === '2025-05-12', a10.data);
t('ata10: rodapé por página removido', !/página \d/.test(E.normalizeText(r10.text)));
const r9 = await AtaPdf.extract(pdfjsLib, read('ata9-digitalizada.pdf'), { ocr: false });
t('ata9 (digitalizada): páginas sem texto detectadas para OCR', JSON.stringify(r9.semTexto) === '[1,2]' && !r9.text.trim(), r9.semTexto);

console.log('\n' + ok + ' ok / ' + bad + ' falhas');
process.exitCode = bad ? 1 : 0;
