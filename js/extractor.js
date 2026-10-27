/* ============================================================
   EXTRATOR DE ATAS  (js/extractor.js)  —  versão 4
   ------------------------------------------------------------
   Pipeline (cada etapa é uma função independente):

     1. normalizeText()      limpa o texto, preservando quebras de linha
     2. buildStructure()     descobre a estrutura (pauta, itens numerados,
                             títulos ou texto corrido) e divide em BLOCOS
     3. extractItems()       dentro de cada bloco, sentença a sentença:
                             decisões, encaminhamentos, problemas,
                             demandas e sugestões (com nível de confiança)
     4. findTemporal()       prazos e referências temporais (datas, períodos,
                             eventos, reuniões futuras, expressões vagas)
     5. extractActors()      responsáveis (pessoas, cargos e grupos)
     6. recurringTerms()     termos recorrentes — INDEPENDENTE dos assuntos
     7. dedupe + confiança

   Princípio: nada é inventado. Se não houver evidência textual
   suficiente, o campo fica vazio / "não identificado".
============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtaExtractor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const VERSION = 5;   // v3: estrutura × conteúdo, relato × ação · v4: confiança calibrada · v5: layout do PDF, OCR, datas por extenso, nome do ficheiro

/* ---------- utilitários ---------- */
// Remove acentos MANTENDO o comprimento da string (índices continuam válidos
// na string original) e põe em minúsculas.
const fold = s => String(s)
  .replace(/[\u00C0-\u017F]/g, c => c.normalize('NFD').charAt(0))
  .replace(/[A-Z]/g, c => c.toLowerCase());
const rx = flags => (strs, ...vals) => new RegExp(String.raw(strs, ...vals), flags);
const wordsOf = s => (String(s).match(/\S+/g) || []);
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const squash = s => String(s).replace(/\s+/g, ' ').trim();
const trimEnd = s => String(s).replace(/[\s.,;:!?\-–—]+$/, '');
const trimStart = s => String(s).replace(/^[\s\-–—•*·.,;:]+/, '');
const clip = (s, n) => s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
const pad2 = n => String(n).padStart(2, '0');

const MES_ALT = 'janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const MES_F = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const MES_NUM = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };

function isoOf(y, m, d) {
  y = +y; m = +m; d = +d;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  if (y < 100) y += 2000;
  return y + '-' + pad2(m) + '-' + pad2(d);
}

/* ============================================================
   1. NORMALIZAÇÃO
============================================================ */
// chave de comparação para cabeçalho/rodapé: sem acento, minúscula, números → "#"
const hfKey = l => fold(squash(l)).replace(/\d+/g, '#');
const RE_ITEM_LINE = /^\d{1,2}\s*[.)]\s|^(?:item|ponto)\s+\d/i;

function normalizeText(raw) {
  let t = String(raw == null ? '' : raw);
  t = t.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[    ]/g, ' ')
    .replace(/[­​-‍﻿]/g, '');
  // ordinal sobrescrito que o PDF põe noutra linha: "a prof\na Fulana" → "a profª Fulana"
  // (também "prof a Fulana" / "profa\nFulana" vindos de extrações que separam o sobrescrito)
  t = t.replace(/(\b(?:[Pp]rof|[Dd]r|[Ss]r))\.?[ \t]*\n?[ \t]*([ao])(?=[ \t]+[A-ZÀ-Ú][a-zà-ú])/g, (m, a, b) => a + (b === 'a' ? 'ª' : 'º'));

  /* ---- cabeçalho/rodapé por POSIÇÃO NA PÁGINA (quando o texto traz \f entre páginas) ----
     Uma linha que aparece no topo ou no pé de pelo menos metade das páginas é cabeçalho/rodapé
     ("Universidade…", "Centro de…", "Página 2 de 5", "Ata da reunião… – data"), qualquer que
     seja o texto. Só é removida nessas zonas: o mesmo texto no meio da página é conteúdo. */
  const pages = t.split('\f');
  if (pages.length >= 2) {
    const ZONE = 4;
    const pl = pages.map(pg => pg.split('\n'));
    const zoneIdx = pl.map(lines => {
      const nz = []; lines.forEach((l, i) => { if (l.trim()) nz.push(i); });
      return new Set(nz.slice(0, ZONE).concat(nz.slice(-ZONE)));
    });
    const pagesWith = new Map();
    pl.forEach((lines, p) => zoneIdx[p].forEach(i => {
      const k = hfKey(lines[i]); if (k.length < 3) return;
      if (!pagesWith.has(k)) pagesWith.set(k, new Set());
      pagesWith.get(k).add(p);
    }));
    const minPages = Math.max(2, Math.ceil(pages.length * 0.5));
    const hf = new Set(Array.from(pagesWith).filter(([k, ps]) => ps.size >= minPages && !RE_ITEM_LINE.test(k)).map(([k]) => k));
    let keptHead = 0;
    const kept = pl.map((lines, p) => {
      const pg = [];
      lines.forEach((l, i) => {
        if (zoneIdx[p].has(i) && hf.has(hfKey(l))) {
          // a 1ª ocorrência no topo da 1ª página é o cabeçalho do documento: fica uma vez
          if (p === 0 && i <= 6 && keptHead < 6) { keptHead++; pg.push(l); }
          return;
        }
        pg.push(l);
      });
      while (pg.length && !pg[pg.length - 1].trim()) pg.pop();     // linhas vazias nas bordas da página
      while (pg.length && !pg[0].trim()) pg.shift();
      return pg.join('\n');
    }).filter(Boolean);
    // fronteira de página não é fronteira de parágrafo: só uma quebra de linha
    t = kept.join('\n');
  }
  t = t.replace(/\f/g, '\n');
  // palavra partida por hífen no fim da linha: "infor-\nmação"
  t = t.replace(/([a-zà-ú])-[ \t]*\n[ \t]*([a-zà-ú])/g, '$1$2');

  let lines = t.split('\n').map(l =>
    l.replace(/^[ ]+/, '').replace(/[ \t]+$/, '').replace(/ {3,}/g, '\t').replace(/ {2}/g, ' '));

  // números de página ("Página 2 de 5", "- 3 -", "2/5")
  const pageRe = /^(?:p[áa]g(?:ina)?\.?\s*)?\d{1,3}\s*(?:\/|de)\s*\d{1,3}$|^[-–—]\s*\d{1,3}\s*[-–—]$|^p[áa]gina\s+\d{1,3}$/i;
  lines = lines.filter(l => !pageRe.test(l.trim()));

  /* ---- sem marcas de página: linhas curtas repetidas 3+ vezes (comparadas com números
     normalizados) são cabeçalho/rodapé. Não remove itens numerados, frases (pontuação final)
     nem linhas com cara de decisão. A 1ª ocorrência entre as primeiras linhas do documento
     (cabeçalho institucional) é mantida uma vez. */
  const counts = new Map();
  lines.forEach(l => { const k = l.trim(); if (k.length >= 12 && k.length <= 140) { const h = hfKey(k); counts.set(h, (counts.get(h) || 0) + 1); } });
  const keepRe = /aprov|decid|defer|rejeit|unanim|maioria|encaminh|respons|prazo|votac/i;
  const keptOnce = new Set();
  let nonEmpty = 0;
  lines = lines.filter(l => {
    const k = l.trim();
    if (k) nonEmpty++;
    const h = hfKey(k);
    if ((counts.get(h) || 0) < 3) return true;
    if (RE_ITEM_LINE.test(k) || /[.!?;:]$/.test(k) || keepRe.test(k)) return true;
    if (nonEmpty <= 8 && !keptOnce.has(h)) { keptOnce.add(h); return true; }
    return false;
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ============================================================
   DATA E TÍTULO DA REUNIÃO
============================================================ */
/* ---------- números por extenso (datas de ata: "aos vinte e seis dias", "dois mil e vinte e cinco") ---------- */
const NUM_WORDS = { um: 1, uma: 1, primeiro: 1, primeira: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezassete: 17,
  dezoito: 18, dezenove: 19, dezanove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };
const NUMW_ALT = Object.keys(NUM_WORDS).sort((x, y) => y.length - x.length).join('|');
const NUMW_SEQ = '(?:' + NUMW_ALT + '|mil)(?:\\s+(?:e\\s+)?(?:' + NUMW_ALT + '|mil))*';
function wordsToNumber(str) {
  const toks = fold(String(str)).split(/\s+/).filter(t => t && t !== 'e');
  if (!toks.length) return null;
  let total = 0, cur = 0;
  for (const t of toks) {
    if (t === 'mil') { total += (cur || 1) * 1000; cur = 0; continue; }
    if (!(t in NUM_WORDS)) return null;
    cur += NUM_WORDS[t];
  }
  return total + cur;
}
const toNum = s => /^\d+$/.test(s) ? +s : wordsToNumber(s);

/* Data da reunião: entre as datas do início da ata, prefere a que tem CONTEXTO de reunião
   ("aos … dias", "no dia …", "realizada em", "reuniram-se", "em sessão") — a primeira data que aparece
   pode ser um prazo ou a data de um documento citado. Aceita dia e ano por extenso. */
function findMeetingDate(text) {
  const CTX_BEFORE = /(?:\baos?|\bno\s+dia|\bnos\s+dias|\brealizad[oa]s?\s+(?:em|n[oa]|aos?)|\breuni(?:ram|u)-se\s+(?:em|n[oa]|aos?)|\bem\s+sessao\s+(?:\S+\s+){0,2}(?:em|de)|\bdata\s*:|\bdia)\s*$/;
  const CTX_AFTER = /^[^.]{0,120}?\breuni(?:ram|u)-se\b|^[^.]{0,80}?\b(?:as|a)\s+\d{1,2}\s*(?:h|:)/;
  const scan = (src) => {
    const n = fold(src);
    const out = [];
    let m;
    const reTxt = new RegExp('(\\d{1,2}|' + NUMW_SEQ + ')\\s*(?:º|°|o)?\\s*(?:dias?\\s+(?:do\\s+m[eê]s\\s+)?)?(?:de\\s+)?(' + MES_F + ')\\s+(?:de|do\\s+ano\\s+de)\\s+(\\d{4}|' + NUMW_SEQ + ')', 'g');
    while ((m = reTxt.exec(n))) {
      const d = toNum(m[1]), y = toNum(m[3]);
      if (!d || !y || y < 1900 || y > 2100) continue;
      const iso = isoOf(y, MES_NUM[m[2]], d);
      if (iso) out.push({ idx: m.index, iso, end: m.index + m[0].length });
    }
    const reNum = /(?:^|[^\d\/.\-])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?![\d])/g;
    while ((m = reNum.exec(n))) {
      const iso = isoOf(m[3], m[2], m[1]);
      const at = m.index + m[0].indexOf(m[1]);
      if (iso) out.push({ idx: at, iso, end: at + m[0].length });
    }
    out.forEach(o => {
      const before = n.slice(Math.max(0, o.idx - 40), o.idx), after = n.slice(o.end, o.end + 140);
      const lineStart = n.lastIndexOf('\n', o.idx - 1) + 1;
      o.ctxBefore = CTX_BEFORE.test(before);
      o.ctx = o.ctxBefore || CTX_AFTER.test(after);
      o.doc = /\b(?:resolucao|portaria|edital|lei|decreto|oficio|memorando|instrucao\s+normativa|parecer|processo|despacho|deliberacao)\b(?:\s+(?:n[ºo°.]*\s*)?[\w.\/-]+)?\s+(?:de|em)?\s*$/.test(before);
      o.prazo = /\b(?:ate|prazo|antes\s+d[eo]|apos|partir\s+d[eo]|limite)\b[^\n]{0,15}$/.test(before);
      o.header = lineStart === o.idx && n.slice(o.idx, n.indexOf('\n', o.idx) < 0 ? undefined : n.indexOf('\n', o.idx)).length <= 40;   // linha só com a data
    });
    return out.sort((a, b) => a.idx - b.idx);
  };
  const pick = list => {
    const c = list.filter(o => !o.doc);
    return c.find(o => o.ctxBefore && !o.prazo) || c.find(o => o.ctx && !o.prazo) || c.find(o => o.header) || c.find(o => !o.prazo) || c[0] || list[0] || null;
  };
  const head = pick(scan(text.slice(0, 3000)));
  if (head) return head.iso;
  const all = pick(scan(text));
  return all ? all.iso : null;
}

/* Pistas no NOME DO FICHEIRO (último recurso, sempre marcado como tal):
   "Ata - 1ª Reunião Ordinária - 2026-08-26.pdf", "ata_12-03-2026.txt", "ATA 5 de junho de 2026.pdf".
   Datas ambíguas (duas datas diferentes no nome) não são usadas. */
function metaFromFilename(name) {
  if (!name) return { data: null, reuniao: null };
  const base = String(name).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_+/g, ' ');
  const dates = new Set();
  let m;
  const push = (y, mo, d) => { y = +y; if (y >= 1950 && y <= 2100) { const iso = isoOf(y, mo, d); if (iso) dates.add(iso); } };
  const reISO = /(?:^|[^\d])((?:19|20)\d{2})[-.\s](\d{1,2})[-.\s](\d{1,2})(?!\d)/g;
  while ((m = reISO.exec(base))) push(m[1], m[2], m[3]);
  const reBR = /(?:^|[^\d])(\d{1,2})[-.\s](\d{1,2})[-.\s]((?:19|20)\d{2})(?!\d)/g;
  while ((m = reBR.exec(base))) push(m[3], m[2], m[1]);
  const reCompact = /(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/g;
  while ((m = reCompact.exec(base))) push(m[1], m[2], m[3]);
  const reTxt = new RegExp('(\\d{1,2})\\s*(?:º|o)?\\s+de\\s+(' + MES_ALT + ')\\s+de\\s+(\\d{4})', 'gi');
  while ((m = reTxt.exec(base))) push(m[3], MES_NUM[fold(m[2])], m[1]);
  const data = dates.size === 1 ? Array.from(dates)[0] : null;
  const mr = base.match(/(?:\d+\s*[ªºa°o]?\s*)?reuni[ãa]o\s+(?:ordin[áa]ria|extraordin[áa]ria|conjunta|solene)(?:\s+(?:n[º°o.]*\s*)?\d+)?(?:\s*[-–]?\s*(?:19|20)\d{2}[.\/][12](?!\d))?/i);
  return { data, reuniao: mr ? squash(mr[0].replace(/\s*[-–]\s*/g, ' ')) : null, ambigua: dates.size > 1 };
}

/* Identificação da reunião: TIPO da sessão + ÓRGÃO. Genérico para colegiados, conselhos, comissões,
   congregações, assembleias, câmaras, departamentos, núcleos, diretorias… e para "Ata nº X/AAAA". */
const BODY_HEAD = String.raw`(?:Colegiado|Conselho|Comiss[ãa]o|Congrega[çc][ãa]o|Assembleia|C[âa]mara|Departamento|N[úu]cleo|Diretoria|Comit[êe]|Plen[áa]ria|Junta|F[óo]rum|Coordena[çc][ãa]o|Grupo\s+de\s+Trabalho)`;
function findReuniao(text) {
  const raw = text.slice(0, 3000);                 // COM quebras de linha: o título nunca atravessa linhas
  const head = raw.replace(/\s+/g, ' ');
  const mTitle = head.match(/\b(?:\d+\s*[ªºa°]?\s*)?(?:Reuni[ãa]o|Sess[ãa]o)\s+(?:Ordin[áa]ria|Extraordin[áa]ria|Solene|Conjunta|Especial|Plen[áa]ria)(?:\s+(?:n[ºo°.]*\s*)?\d+(?:[\/.]\d{1,4})?)?/i)
    || head.match(/\b(?:\d+\s*[ªºa°]?\s*)?Assembleia\s+Geral(?:\s+(?:Ordin[áa]ria|Extraordin[áa]ria))?(?:\s+(?:n[ºo°.]*\s*)?\d+(?:[\/.]\d{1,4})?)?/i);
  const mCurso = raw.match(/Colegiado\s+(?:do|de)\s+Curso\s+(?:de|do)\s+[^.,;\d\n]{3,80}?(?=\s+(?:\d{1,2}\s+de\s+[a-zçãéíóú]+|em\s+\d|realizad|ocorrid|aos\s|link\b)|[.,;\n]|$)/i)
    || raw.match(/Colegiado\s+(?:do|de)\s+[^.,;\d\n]{3,70}/i)
    || raw.match(new RegExp('(?:^|\\n)\\s*(' + BODY_HEAD + '\\s+(?:d[aeo]s?|de)\\s+[^.,;\\d\\n]{3,70})', 'i'));
  const body = mCurso ? (mCurso[1] || mCurso[0]) : null;
  const mNum = head.match(/\bAta\s+(?:n[ºo°.]*\s*)?(\d{1,4}\s*[\/.\-]\s*\d{2,4}|\d{1,4}(?=\s+d[aeo]\s))/i);
  const clean = x => squash(x).replace(/\s+(?:link|zoom|meet)\b.*$/i, '');
  if (mTitle && body) return clean(mTitle[0] + ' — ' + body);
  if (mTitle) {
    // órgão logo depois do tipo de sessão: "112ª Reunião Extraordinária do Conselho do Departamento de…"
    // procura no texto COM quebras de linha: o nome do órgão não atravessa para a linha seguinte
    const tl = mTitle[0].trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const at = raw.search(new RegExp(tl, 'i'));
    const rest = at >= 0 ? raw.slice(at).replace(new RegExp('^' + tl, 'i'), '').split('\n')[0] : '';
    const mb = rest.match(/^\s+d[aeo]s?\s+([A-ZÀ-Ú][^.,;:\d]{3,90}?)(?=\s+(?:realizad|ocorrid|aos?\s|as\s+\d|às\s|no\s+dia|em\s+\d|em\s+\w+\s+de\s+\d|\d{1,2}\s+de\s)|[.,;:\d]|$)/);
    return clean(mTitle[0] + (mb ? ' — ' + mb[1] : ''));
  }
  if (body && mNum) return clean('Ata nº ' + mNum[1].replace(/\s+/g, '') + ' — ' + body);
  if (body) return clean(body);
  if (mNum) {
    const after = head.slice(head.indexOf(mNum[0]) + mNum[0].length).match(new RegExp('^\\s+d[aeo]s?\\s+(' + BODY_HEAD + '[^.,;\\d]{2,70})', 'i'));
    return clean('Ata nº ' + mNum[1].replace(/\s+/g, '') + (after ? ' — ' + after[1] : ''));
  }
  const alt = raw.slice(0, 600).match(/Ata\s+d[aeo]s?\s+[^.\n]{3,80}/i);
  return alt ? clean(alt[0]) : null;
}

/* ============================================================
   SEPARAÇÃO EM SENTENÇAS (sem lookbehind — compatível com Safari antigo)
============================================================ */
const ABBR = new Set(['prof','profa','dr','dra','sr','sra','srs','art','arts','n','nr','p','pp','cap','inc','par','al',
  'ex','av','cia','ltda','obs','fig','vol','ed','ref','resp','coord','dept','depto','univ','vs','ilmo','exmo','exma',
  'pag','proc','cf','aprox','tel']);

function splitSentences(text) {
  const out = [];
  const L = text.length;
  let start = 0;
  for (let i = 0; i < L; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    let j = i;
    while (j + 1 < L && /[.!?…]/.test(text[j + 1])) j++;
    let k = j + 1;
    while (k < L && /["”')\]]/.test(text[k])) k++;
    if (k < L && !/\s/.test(text[k])) { i = j; continue; }
    let p = k;
    while (p < L && /\s/.test(text[p])) p++;
    if (p < L && c === '.') {
      if (!/[A-ZÀ-Ú0-9"“(\[]/.test(text[p])) { i = j; continue; }       // minúscula depois: não é fim
      // enumerador de sublista no meio do parágrafo: "...históricos: 1. Discente..." / "... 2024.1. 2. Discente..."
      const en = j === i ? text.slice(start, i).match(/(^|[\s(])(\d{1,2})$/) : null;
      if (en) {
        const numStart = i - en[2].length;
        const before = text.slice(start, numStart).replace(/\s+$/, '');
        if (!before || /[:;.!?]$/.test(before)) {
          if (before) { out.push(before.trim()); start = numStart; }
          i = j; continue;
        }
      }
      const m = text.slice(start, i).match(/([A-Za-zÀ-ú]+)$/);
      if (m) {
        if (j === i && ABBR.has(fold(m[1]))) { i = j; continue; }       // Prof. Dr. Art. ...
        // inicial ("J. Silva") — mas não quando a palavra seguinte é artigo/função ("Física I. As três...")
        const nextW = (text.slice(p).match(/^[A-Za-zÀ-ú]+/) || [''])[0];
        if (m[1].length === 1 && /[A-ZÀ-Ú]/.test(m[1]) && !CAP_STOP.has(nextW)) { i = j; continue; }
      }
    }
    out.push(text.slice(start, k).trim());
    start = p;
    i = Math.max(i, p - 1);
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);

  // sentenças muito longas: quebra em ';' (deliberações costumam vir assim)
  const final = [];
  out.filter(Boolean).forEach(s => {
    if (s.length <= 300 || s.indexOf(';') < 0) { final.push(s); return; }
    const parts = s.split(/;\s+/);
    let acc = '';
    parts.forEach((pt, idx) => {
      acc = acc ? acc + '; ' + pt : pt;
      if (acc.length >= 60 || idx === parts.length - 1) { final.push(acc); acc = ''; }
    });
  });
  return final;
}

/* ============================================================
   LÉXICOS COMPARTILHADOS
============================================================ */
const STOPWORDS = new Set(('de da do das dos em no na nos nas um uma uns umas e ou a o as os que se para por com sem sobre ' +
 'quais qual quando onde quem como foi foram é são ser está estão tem têm ainda mais menos entre até desde já não sim seu sua seus suas ' +
 'este esta esse essa aquele aquela isso isto aos às pelo pela pelos pelas nosso nossa nossos nossas qualquer ' +
 'ata atas reunião reuniões ordinária extraordinária colegiado curso bacharelado licenciatura ' +
 'presidente presentes presente ausentes ausente justificada pauta ' +
 'aprovado aprovada aprovados reprovado unanimidade membros membro coordenador coordenadora coordenação departamento setor assinado assinada assinatura ' +
 'documento processo parecer favorável contrário voto votação relato relator relatora assunto assuntos ' +
 'decisão decisões encaminhamento encaminhamentos prazo prazos responsável responsáveis data local horário horas abertura encerramento ' +
 'lista após palavra todos todas outros outras termo termos ' +
 'abril janeiro fevereiro março maio junho julho agosto setembro outubro novembro dezembro ' +
 'dia mês ano informes ordem assinam também ainda então assim sendo será serão deverá deverão ' +
 'foram havia havendo sobre sido ter tendo cada outro outra mesmo mesma essas esses estas estes ' +
 'resolução portaria lei artigo inciso conforme considerando resolve referentes ' +
 'professor professora prof profa alunos aluno aluna alunas discente docente ' +
 'informou informaram disse falou disseram colocou apresentou').split(/\s+/));

const ACTOR_LIST = ['coordenacao','coordenador','coordenadora','coordenadores','vice-coordenacao','vice-coordenador',
  'vice-coordenadora','secretaria','secretario','secretaria','equipe','equipes','grupo','grupos','comissao','comissoes',
  'colegiado','direcao','diretor','diretora','diretoria','departamento','chefia','chefe','professor','professora',
  'professores','professoras','docente','docentes','discente','discentes','estudante','estudantes','aluno','aluna',
  'alunos','alunas','representante','representantes','representacao','conselho','reitoria','pro-reitoria','proreitoria',
  'setor','nucleo','banca','presidente','vice-presidente','todos','membros','membro','relator','relatora','servidores',
  'servidor','orientador','orientadora','orientadores','tutor','tutores','monitores','bolsistas','assessoria','ouvidoria',
  'biblioteca','comite','nde','prograd','proex','propg','dce','daa'];
const ACTOR_SET = new Set(ACTOR_LIST);
const ACTOR_ALT = ACTOR_LIST.slice().sort((a, b) => b.length - a.length).join('|');
const ROLE_SET = new Set(['coordenador','coordenadora','vice-coordenador','vice-coordenadora','secretario','secretaria',
  'diretor','diretora','presidente','vice-presidente','professor','professora','chefe','relator','relatora',
  'representante','orientador','orientadora','tutor','aluno','aluna','estudante','discente','docente']);
const TITLE_SET = new Set(['prof','profa','professor','professora','dr','dra','sr','sra']);
/* Tipos de entidade:
     pessoa — nome próprio identificado ("Prof. Fulano de Tal")
     orgao  — grupo/órgão/instância ("Coordenação", "Comissão de Matrícula", "NDE", "Secretaria")
     cargo  — posição individual sem nome ("o coordenador", "a relatora", "o presidente")
     papel  — CATEGORIA genérica de pessoas ("discente", "professores", "alunos", "membros")
   Papel genérico nunca vira responsável só por ser citado: precisa de ação explicitamente atribuída. */
const GENERIC_ROLES = new Set(['professor','professora','professores','professoras','docente','docentes','discente','discentes',
  'estudante','estudantes','aluno','aluna','alunos','alunas','membro','membros','todos','servidor','servidores','representante',
  'representantes','orientador','orientadora','orientadores','tutor','tutores','monitores','bolsistas']);
const CARGO_SET = new Set(['coordenador','coordenadora','coordenadores','vice-coordenador','vice-coordenadora','secretario','diretor','diretora',
  'presidente','vice-presidente','chefe','relator','relatora']);
function entityTipo(groupToks) {
  const heads = groupToks.map(t => fold(tokClean(t))).filter(f => ACTOR_SET.has(f));
  const h = heads[0];
  if (!h) return 'orgao';
  if (GENERIC_ROLES.has(h)) return 'papel';
  if (CARGO_SET.has(h)) return 'cargo';
  return 'orgao';
}
const ORG_ACRONYMS = new Set(['NDE','PROGRAD','PROEX','PROPG','DAA','DCE','CAPES','CNPQ','MEC','PPC','TCC','CPA','CONSEPE','CONSUN','NAPNE','CDA']);

// Palavras capitalizadas que NÃO são nomes de pessoa.
const CAP_STOP = new Set(('O A Os As Um Uma Em No Na Nos Nas Ao Aos À Às Da Do De Das Dos Foi Ficou Ficaram Foram Será Serão Também Assim Então ' +
 'Ainda Colegiado Curso Coordenação Secretaria Universidade Departamento Reunião Ata Pauta Item Assunto Informes Segundo Conforme ' +
 'Após Antes Durante Quanto Sobre Para Por Com Sem Essa Esse Este Esta Isso Todos Todas Cada Alguns Algumas Nesse Nessa Neste Nesta ' +
 'Houve Há Mas Porém Contudo Todavia Já Ademais Além Portanto Logo Posteriormente Inicialmente Finalmente Primeiramente Depois Quando ' +
 'Se Caso Como Que Onde Qual Quais Deverá Deverão Prazo Responsável Decisão Encaminhamento Proposta Projeto Resolução Portaria Edital Lei ' +
 'Artigo Art Instituto Centro Escola Faculdade Federal Estadual Municipal Brasil Presidente Coordenador Coordenadora Professor Professora ' +
 'Prof Profa Dr Dra Sr Sra Aluno Aluna Estudante Discente Docente Representante Diretor Diretora Eu Nós Ele Ela Eles Elas ' +
 'Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro ' +
 'Segunda Terça Quarta Quinta Sexta Sábado Domingo Ordinária Extraordinária Semestre Período Ano Mês Dia Hoje Amanhã ' +
 'Seguindo Passando Prosseguindo Iniciando Encerrando Sobretudo Inclusive Aliás Enfim Ademais Igualmente Vale Pode Podem ' +
 'Nada Nenhum Nenhuma Outro Outra Outros Outras Ambos Ambas Mesmo Mesma Ausentes Ausente Presentes Presente Justificativa Justificativas Convidados Participantes Link Pauta Assinaturas').split(/\s+/));

const NON_ACTION_FUT = new Set(['seguira','seguirao','ofertara','ofertarao','concedera','concederao','adotara','adotarao','oferecera','oferecerao','garantira','assegurara','prevalecera','considerara','respeitara','cumprira','permanecera','mantera','manterao','sera','serao','estara','estarao','havera','haverao','podera','poderao','tera','terao',
  'ocorrera','ocorrerao','acontecera','acontecerao','vigorara','valera','dependera','constara','constarao','existira',
  'existirao','correspondera','equivalera','abrangera','incluira','contera','somara','totalizara','permitira',
  'possibilitara','implicara','significara','resultara','refletira','impactara','durara','vera','verao']);
const AMBIG_FUT = new Set(['iniciara','comecara','terminara','encerrara','passara','entrara','entrarao','aplicara','funcionara']);
const NON_ACTION_INF = new Set(['ofertar','conceder','permitir','adotar','seguir','cumprir','respeitar','observar','obedecer','possuir','prevalecer','garantir','assegurar','manter','considerar','exigir','dispor','corresponder','equivaler','ser','estar','haver','ter','existir','depender','continuar','ocorrer','acontecer','parecer','valer','constar','vigorar']);
const NON_ACTION_PART = /^(?:aprovad|reprovad|deferid|indeferid|considerad|mantid|vigent|valid|permitid|tid|admitid|aceit|rejeitad|ofertad|concedid|adotad|seguid|garantid|assegurad|autorizad|liberad|aplicad|previst)/;
// Verbos de AÇÃO OPERACIONAL (alguém faz algo concreto). Regras/regimes ("será ofertada",
// "será concedido", "será permitido", "seguirá") NÃO estão aqui — descrevem normas, não tarefas.
const OP_STEMS = ['envi','encaminh','elabor','realiz','lev','convoc','cri','solicit','organiz','contat','providenci','agend','consult','verific','divulg','public','apresent','analis','revis','atualiz','comunic','notific','ofici','formaliz','marc','discut','paut','retom','reavali','submet','institu','implant','implement','cadastr','emit','expedi','convid','reuni','articul','redig','prepar','cobr','design','nome','inclu','levant','apur','avali','entreg','prop','defin','busc','mape','sistematiz','document','registr','averigu','investig','esclarec','orient','mobiliz','estabelec','conduz','coorden','acompanh','monitor','abert','abr','feit','faz','far','remarc','reagend','reenvi','reformul','reorganiz','redefin','reabr'];
function isOperational(word) {
  const f = fold(String(word)).replace(/-se$/, '');
  return OP_STEMS.some(st => f.startsWith(st));
}

/* ============================================================
   PAUTA, TÍTULOS E ESTRUTURA
============================================================ */
const RE_NUM_HEAD = /^(?:(?:item|ponto|assunto|pauta|t[óo]pico)\s*(?:n[ºo°.]*\s*)?)?(\d{1,2})\s*(?:[ºo°])?\s*[.)\]:–—-]+\s*(?=[A-Za-zÀ-ÿ"“(])(.+)$/i;
const RE_ITEM = /^(?:item|ponto|assunto|t[óo]pico)\s*(?:n[ºo°.]*\s*)?(\d{1,2})\b\s*[.:)\-–—]*\s*(.*)$/i;
const RE_LIST = /^(?:[-•*▪●○◦–—]\s+|[a-z]\s*[.)]\s+|\(\s*[a-z0-9]{1,2}\s*\)\s+|\d{1,2}\.\d{1,2}\.?\s+)/;
const ACT_INF_START = /^(?:encaminhar|providenciar|enviar|elaborar|verificar|solicitar|realizar|convocar|organizar|divulgar|publicar|agendar|contatar|consultar|analisar|revisar|atualizar|apresentar|levar|marcar|criar|retomar|reavaliar|comunicar|notificar|oficiar|formalizar|definir|incluir|preparar|redigir|cobrar|reunir|convidar|articular|propor|discutir|pautar|aprovar|rejeitar|manter|ratificar|homologar|autorizar|designar|nomear)\b/i;

const PROCEDURAL_RE = /^(?:informes?|comunicacoes?|expediente|abertura|encerramento|aprovacao\s+d[aeo]s?\s+(?:ata|pauta)|leitura\s+d[aeo]s?\s+ata|ata\s+anterior|verificacao\s+de\s+quorum|quorum|assuntos\s+gerais|outros\s+assuntos|assuntos\s+diversos|o\s+que\s+ocorrer|palavra\s+livre|o\s+que\s+houver|ordem\s+do\s+dia|pauta|presencas?|justificativas?|apresentacao\s+da\s+pauta|inclusao\s+de\s+pauta|assinaturas?|considera[cç]oes?\s+iniciais|aprovacao\s+da\s+ata\s+anterior|informe\s+geral)\b/;
function isProceduralSubject(s) { return PROCEDURAL_RE.test(fold(squash(s || ''))); }

// Remove apenas delimitadores EXTERNOS pareados: "(...)", [...], "..." — nunca um ")" final
// que pertença ao conteúdo (ex.: "Defesa de TCC (matrícula 2019123456)").
function stripOuter(t) {
  t = t.trim();
  const pairs = { '(': ')', '[': ']', '"': '"', '“': '”' };
  for (let k = 0; k < 2; k++) {
    const open = t.charAt(0), close = pairs[open];
    if (!close || t.length < 3 || t.charAt(t.length - 1) !== close) break;
    if (open === '(' || open === '[') {            // o par externo precisa fechar só no último caractere
      let depth = 0, wholeWrap = true;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === open) depth++; else if (t[i] === close) depth--;
        if (depth === 0 && i < t.length - 1) { wholeWrap = false; break; }
      }
      if (!wholeWrap) break;
    }
    t = t.slice(1, -1).trim();
  }
  return t;
}

/* ---------- títulos: integridade e separação estrutura × conteúdo ---------- */
// Profundidade de parênteses/colchetes ainda abertos no fim da string.
function parenDepth(s) {
  let d = 0;
  for (const c of String(s)) { if (c === '(' || c === '[') d++; else if ((c === ')' || c === ']') && d > 0) d--; }
  return d;
}
// Título que termina "pendurado" (preposição, artigo, conjunção, título honorífico, vírgula,
// parêntese aberto...) continua obrigatoriamente na linha seguinte — típico de quebra de linha do PDF.
// Artigos/conjunções de uma letra só contam em minúscula ("Turma A", "Plano B", "Cálculo A" são títulos completos).
const DANGLING_END = /(?:(?:^|\s)(?:de|da|do|das|dos|ou|em|no|na|nos|nas|para|por|pela|pelo|pelas|pelos|com|sem|sobre|as|os|ao|aos|à|às|entre|até|ate|contra|perante|prof|profa|dr|dra|sr|sra|relatoria|relator|relatora|n[ºo°])\.?|[,(\[\-–—\/&+])$/i;
const DANGLING_1 = /(?:^|\s)(?:a|o|e)$/;
function headingWantsContinuation(t) { t = String(t).trim(); return parenDepth(t) > 0 || DANGLING_END.test(t) || DANGLING_1.test(t); }
const RE_OCR_ROMAN = /^([IVXl1|]{2,6})\s*[.)\-–—:]+\s*(?=[A-ZÀ-Ú"“(])(.+)$/;
const RE_ROMAN_HEAD = /^(?:(?:item|ponto|assunto|pauta|t[óo]pico)\s+)?([IVXL]{1,6})\s*[.)\-–—:]+\s*(?=[A-ZÀ-Ú"“(])(.+)$/;
function romanValue(s) {
  const v = { I: 1, V: 5, X: 10, L: 50 };
  let total = 0;
  for (let i = 0; i < s.length; i++) { const a = v[s[i]], b = v[s[i + 1]] || 0; total += a < b ? -a : a; }
  // aceita só a grafia canônica (evita "VV", "IIII"...)
  const canon = n => { const t = [[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let o = ''; t.forEach(([k, r]) => { while (n >= k) { o += r; n -= k; } }); return o; };
  return total >= 1 && total <= 40 && canon(total) === s ? total : null;
}
function isHeadingLine(t) {
  return RE_NUM_HEAD.test(t) || RE_ITEM.test(t) || (RE_ROMAN_HEAD.test(t) && romanValue(t.match(RE_ROMAN_HEAD)[1]) != null);
}
/* Junta a(s) linha(s) seguinte(s) a um cabeçalho quando o título claramente continua
   (parêntese aberto, final pendurado, ou linha curta em minúscula). Se a linha de continuação
   fecha o parêntese e segue com texto ("Almeida) O professor relatou..."), só a parte do
   título é absorvida; o resto volta a ser corpo.
   Retorna { text, consumed:[índices], rest } — rest = corpo que sobrou na última linha. */
function mergeHeadingContinuation(info, i, text0) {
  let text = String(text0 || '').trim();
  const consumed = [];
  let rest = '';
  for (let j = i + 1, guard = 0; j < info.length && guard < 3; j++, guard++) {
    const nx = info[j].t;
    if (!nx || isHeadingLine(nx) || RE_LIST.test(nx)) break;
    const open = parenDepth(text) > 0;
    const wants = headingWantsContinuation(text);
    const lowerShort = /^[a-zà-ú]/.test(nx) && nx.length <= 60 && !/[.!?]$/.test(nx) && !/[.;:!?]$/.test(text);
    if (!wants && !lowerShort) break;
    if (open) {
      // fecha o parêntese dentro desta linha?
      let d = parenDepth(text), cut = -1;
      for (let k = 0; k < nx.length; k++) {
        if (nx[k] === '(' || nx[k] === '[') d++;
        else if ((nx[k] === ')' || nx[k] === ']') && --d === 0) { cut = k + 1; break; }
      }
      if (cut < 0) {
        if (nx.length > 90) break;                           // linha longa sem fechar: é corpo, não título
        text += ' ' + nx; consumed.push(j); continue;
      }
      if (cut > 90) break;
      text += ' ' + nx.slice(0, cut); consumed.push(j);
      rest = nx.slice(cut).replace(/^[\s.:;,–—-]+/, '').trim();
      break;
    }
    if (nx.length > 90) break;
    // linha de continuação que é uma frase completa (verbo conjugado + ponto final) é corpo, não título
    if (/[.!?]$/.test(nx) && wordsOf(nx).length >= 4 && RE_FINITE.test(fold(nx))) break;
    text += ' ' + nx; consumed.push(j);
    if (/[.;:!?]$/.test(nx)) break;
  }
  return { text: squash(text), consumed, rest };
}
/* Termos de CONTROLE INTERNO (origem, confiança, nível, gatilho...) nunca fazem parte do
   título. Remove apenas quando aparecem colados ao fim (ex.: texto copiado da interface:
   "…Simões)numeração · confiança alta"), sem tocar títulos legítimos como "Revisão da numeração". */
const CONTROL_SEP_TAIL = /(?:\s*[·|]\s*(?:origem|confian[cç]a|n[ií]vel|gatilho|fonte)\b[^·|]*)+$/i;
const CONTROL_GLUED_TAIL = /([)\]"”.])(?:pauta\s*\+\s*)?(?:numera[cç][aã]o|item\s+numerado|origem|confian[cç]a|n[ií]vel|gatilho)\b.*$/i;
function stripControlTerms(t) {
  let prev;
  do { prev = t; t = t.replace(CONTROL_SEP_TAIL, '').replace(CONTROL_GLUED_TAIL, '$1').trim(); } while (t !== prev);
  return t;
}

function cleanTitle(t) {
  if (!t) return null;
  t = squash(t).replace(/^(?:item|ponto|assunto|t[óo]pico)\s*(?:n[ºo°.]*\s*)?\d{1,2}\s*[.:)\-–—]*\s*/i, '')
    .replace(/^\d{1,2}\s*[.)\]:–—-]+\s*/, '').replace(/^[\s\-–—•*·:]+/, '');
  t = stripControlTerms(t);
  t = stripOuter(trimEnd(t));
  if (t.length < 3) return null;
  // cabeçalho TODO EM MAIÚSCULAS -> "Assuntos gerais" (siglas curtas ficam como estão)
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) t = t.split(/\s+/).map(w => w.length > 4 ? w.toLowerCase() : w).join(' ');
  if (wordsOf(t).length > 24) return null;
  return cap1(clip(t, 220));
}

/* Separa "título + corpo" numa mesma linha de item numerado.
   Pontos de corte possíveis: ":"  ·  " – " + Maiúscula  ·  ". " + Maiúscula (fora de abreviação).
   O corte só vale com parênteses BALANCEADOS no título — "(relatoria prof. Fulano)" nunca é partido. */
function splitTitleBody(text) {
  const t = text.trim();
  for (let i = 1; i < t.length - 1; i++) {
    const c = t[i];
    let skip = 0;
    if (c === ':') {
      const after = t.slice(i + 1).trim();
      if (after && !/^[A-ZÀ-Ú0-9"“(]/.test(after) && after.length <= 80) continue;   // "Assunto: relatoria de X" faz parte do título
      skip = 1;
    } else if (c === '.' && /\s/.test(t[i + 1])) {
      const after = t.slice(i + 1).trimStart();
      if (!/^[A-ZÀ-Ú"“]/.test(after)) continue;
      const w = (t.slice(0, i).match(/([A-Za-zÀ-ú]+)$/) || [])[1];
      if (w && (ABBR.has(fold(w)) || (w.length === 1 && /[A-ZÀ-Ú]/.test(w)))) continue;
      skip = 1;
    } else if (/[–—-]/.test(c) && t[i - 1] === ' ' && t[i + 1] === ' ' && /[A-ZÀ-Ú]/.test(t[i + 2] || '')) {
      skip = 1;
    } else continue;
    const head = t.slice(0, i).trim();
    if (parenDepth(head) > 0) continue;
    const nw = wordsOf(head).length;
    // limite por tipo de corte: ":" tolera títulos longos; "." só se curto ou terminado em parêntese
    const maxW = c === ':' ? 22 : (c === '.' ? (/[)\]]$/.test(head) ? 22 : 12) : 14);
    if (nw < 1 || nw > maxW || head.length > 180) break;        // primeiro corte já longo demais: não é título
    return [head, t.slice(i + skip).trim()];
  }
  if (t.length <= 180 && wordsOf(t).length <= 22 && splitSentences(t).length <= 1) return [t, ''];
  return [null, t];
}
// Sobreposição de vocabulário entre dois títulos (0–1, relativa ao menor).
function titleSim(a, b) {
  const A = tokenSet(a || ''), B = tokenSet(b || '');
  if (!A.size || !B.size) return 0;
  let s = 0; A.forEach(x => { if (B.has(x)) s++; });
  return s / Math.min(A.size, B.size);
}

// "1. Informes; 2. Calendário; ..."  ou  "a) ...; b) ..."  ou  "x; y; z"
function splitInlineItems(s) {
  const items = [];
  const re = /(?:^|[\s;])(?:(?:[Ii]tem|[Pp]onto|[Tt][óo]pico)\s*)?(\d{1,2}|[a-h])\s*[.)\-–—]\s*([^;]+?)(?=\s*(?:;|\s(?:(?:[Ii]tem|[Pp]onto|[Tt][óo]pico)\s*)?\d{1,2}\s*[.)\-–—]\s*[A-ZÀ-Ú]|\s[a-h]\)\s*[A-ZÀ-Ú]|$))/g;
  let m;
  while ((m = re.exec(s))) {
    const num = /^\d/.test(m[1]) ? +m[1] : null;
    const title = cleanTitle(m[2]);
    if (title) items.push({ num: num == null ? items.length + 1 : num, title });
  }
  // itens de pauta são curtos e a numeração só cresce; qualquer quebra disso é corpo de ata
  let cut = items.length;
  for (let k = 0; k < items.length; k++) {
    // fim de frase real (não abreviação: "relatoria prof. Fulano" continua sendo título)
    if ((k > 0 && items[k].num <= items[k - 1].num) || items[k].title.length > 180 || splitSentences(items[k].title).length > 1) { cut = k; break; }
  }
  items.length = cut;
  if (items.length >= 2) return items;
  const parts = s.split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every(p => p.length <= 110)) {
    return parts.map((p, i) => ({ num: i + 1, title: cleanTitle(p) })).filter(x => x.title);
  }
  return [];
}

function findPauta(info) {
  const N = info.length;
  const markAlone = /^(?:a\s+)?(?:pauta|ordem\s+do\s+dia|assuntos(?:\s+da\s+pauta)?|itens\s+d[ae]\s+pauta)(?:\s+d[aeo]\s+reuniao)?\s*$/;
  const markColon = /^(?:a\s+)?(?:pauta|ordem\s+do\s+dia|assuntos|itens\s+d[ae]\s+pauta)[^.:\n]{0,70}:/;
  for (let i = 0; i < N; i++) {
    if (!info[i].t) continue;
    const n = info[i].n;
    let inline = '';
    if (markAlone.test(n)) inline = '';
    else if (markColon.test(n)) inline = info[i].t.slice(info[i].t.indexOf(':') + 1).trim();
    else continue;

    let items = inline ? splitInlineItems(inline) : [];
    let to = i;
    if (!items.length && inline && inline.length <= 110 && !/[.]\s/.test(inline)) {
      const one = cleanTitle(inline);
      if (one) items = [{ num: 1, title: one }];
    }
    // linhas seguintes numeradas / com marcadores
    let j = i + 1, blanks = 0, lastItem = null;
    const inlineDone = items.length >= 2;
    while (!inlineDone && j < N && j <= i + 40) {
      const t = info[j].t;
      if (!t) { if (items.length > 0 || ++blanks > 1) break; j++; continue; }
      blanks = 0;
      let mNum = t.match(/^(?:(?:item|ponto|t[óo]pico)\s*(?:n[ºo°.]*\s*)?)?(\d{1,2})\s*(?:[.)\-–—:]\s*|\s+(?=[A-ZÀ-Ú]))(\S.*)$/i);
      let num = mNum ? +mNum[1] : null, body = mNum ? mNum[2] : null;
      if (!mNum && (mNum = t.match(RE_ROMAN_HEAD)) && romanValue(mNum[1]) != null) { num = romanValue(mNum[1]); body = mNum[2]; }
      else if (!body && (mNum = t.match(/^[-•*▪●–—]\s+(.+)$/))) { num = items.length + 1; body = mNum[1]; }
      if (body) {
        const raw = body.trim();
        const title = cleanTitle(raw);
        if (title) { lastItem = { num, title, _raw: raw }; items.push(lastItem); to = j; }
        j++; continue;
      }
      // continuação de título quebrado pelo PDF: parêntese aberto, final pendurado ou minúscula curta
      if (lastItem && t.length <= 90 && (headingWantsContinuation(lastItem._raw) ||
          (/^[a-zà-ú]/.test(t) && !/[.;]$/.test(lastItem._raw)))) {
        lastItem._raw = lastItem._raw + ' ' + t;
        lastItem.title = cleanTitle(lastItem._raw) || lastItem.title; to = j; j++; continue;
      }
      break;
    }
    if (items.length) return { items, from: i, to };
  }
  // pauta inline em parágrafo corrido: "A pauta constou dos seguintes itens: 1) ...; 2) ..."
  // (analisa um parágrafo por vez, para não "vazar" para o corpo da ata)
  const paras = [];
  let acc = [];
  info.slice(0, 60).forEach(x => { if (x.t) acc.push(x.t); else if (acc.length) { paras.push(acc.join(' ')); acc = []; } });
  if (acc.length) paras.push(acc.join(' '));
  for (const para of paras) {
    const m = para.match(/(?:pauta|ordem\s+do\s+dia)[^:]{0,100}:\s*((?:(?:item|ponto|t[óo]pico)\s*)?\d{1,2}\s*[.)\-–—]\s*.+)$/i);
    if (m) {
      const items = splitInlineItems(m[1]);
      if (items.length >= 2) return { items, from: -1, to: -1 };
    }
  }
  return null;
}

/* Linha de lista de presença com status: "Fulano de Tal . . . . . PRESENTE", "Fulana\tAUSENTE",
   "Beltrano – ausência justificada". Reconhecida pelo FORMATO (nome + separador + status), em
   qualquer posição da ata — inclusive depois do encerramento. */
const RE_ATTEND = /^([a-z][a-z'´`^~ .-]{2,90}?)\s*(?:(?:\.\s*){2,}|\t+|\s[-–—]\s|[-–—_]{2,}|:)\s*(presente|ausente|ausencia\s+justificada|falta\s+justificada|ausente\s*\(?\s*justificad[oa]\s*\)?|justificad[oa]|em\s+licenca|licenca|ferias|afastad[oa])\s*\.?$/;
function attendStatus(st) {
  st = fold(st);
  if (/justific/.test(st)) return 'justificada';
  if (/^presente/.test(st)) return 'presente';
  if (/^ausente/.test(st)) return 'ausente';
  return 'afastado';
}
const RE_PRESENCE_HEAD = /^(?:membros\s+)?(?:presentes|ausentes|participantes|compareceram|estiveram\s+presentes|presenca|lista\s+de\s+(?:presenca|membros|frequencia|participantes)|relacao\s+d[eo]s?\s+(?:membros|presentes|participantes|conselheiros|docentes)|frequencia\b|membros\s+(?:do|da)\s+\S+.{0,40}:\s*$|ausencias?\s+justificadas?|justificativas?\s+de\s+ausencia|convidados|assinam|assinaturas?)\b/;
function markRegions(info) {
  const N = info.length;
  const region = new Array(N).fill(null);
  const presenca = RE_PRESENCE_HEAD;
  const closing = /^(?:(?:e\s*,?\s*)?nada\s+mais\s+(?:havendo|a\s+tratar|tendo|sendo)|(?:e\s*,?\s*)?nao\s+havendo\s+mais|sem\s+mais\s+(?:a\s+tratar|assuntos)|encerrou-se|encerramento\b|eu,\s+.{0,60}lavrei|lavrei\s+a\s+presente|assinaturas?\b)/;
  for (let i = 0; i < N; i++) {
    if (!info[i].t) continue;
    if (i >= 3 && closing.test(info[i].n)) {
      for (let j = i; j < N; j++) region[j] = 'encerramento';
      // depois do encerramento ainda pode vir a lista de presença: ela continua sendo presença
      for (let j = i + 1; j < N; j++) {
        if (!info[j].t) continue;
        if (RE_ATTEND.test(info[j].n)) region[j] = 'presenca';
        else if (presenca.test(info[j].n) && info[j].t.length <= 90) {
          let k = j + 1; while (k < N && !info[k].t) k++;
          if (k < N && RE_ATTEND.test(info[k].n)) region[j] = 'presenca';
        }
      }
      break;
    }
    if (RE_ATTEND.test(info[i].n)) { region[i] = 'presenca'; continue; }
    if (presenca.test(info[i].n) && (info[i].t.length <= 80 || /:$/.test(info[i].t))) {
      region[i] = 'presenca';
      let j = i + 1, cnt = 0;
      while (j < N && cnt < 30) {
        const t = info[j].t;
        if (t && (t.length > 120 || RE_NUM_HEAD.test(t) || /^(?:pauta|ordem\s+do\s+dia)/i.test(t))) break;
        if (t && /[a-zà-ú]{4,}\s+[a-zà-ú]{4,}\s+[a-zà-ú]{4,}\s+[a-zà-ú]{4,}/.test(t) && /[.!?]$/.test(t)) break;  // virou prosa
        region[j] = 'presenca'; j++; cnt++;
      }
    }
  }
  return region;
}

/* Subtítulo dentro de um item: "a) Secretaria unificada", "ii. Relatório da comissão".
   É curto, sem pontuação de frase no fim, e é seguido de corpo (linha longa ou "Rótulo:"),
   não de outro item curto — isso o diferencia de uma lista de tarefas "a) Enviar ofício…". */
const RE_SUBHEAD = /^\(?([a-z]|[ivx]{1,4})\s*[).]\s+(\S.{1,110})$/;
function subHeadingAt(info, i) {
  const t = info[i] && info[i].t;
  if (!t) return null;
  const m = t.match(RE_SUBHEAD);
  if (!m) return null;
  const title = m[2].trim();
  if (/[.;,]$/.test(title) || wordsOf(title).length > 14 || !/^[A-ZÀ-Ú0-9"“(]/.test(title)) return null;
  let j = i + 1; while (j < info.length && !info[j].t) j++;
  if (j >= info.length) return null;
  const nx = info[j].t;
  if (RE_SUBHEAD.test(nx) || RE_LIST.test(nx) || RE_ATTEND.test(info[j].n)) return null;
  if (!(nx.length >= 40 || /:$/.test(nx) || RE_FIELD.test(nx))) return null;
  return { marcador: m[1], titulo: cleanTitle(title) || title };
}
// Campo "Rótulo: valor" em linha própria ("Disciplina: X", "Período: AAAA.S", "PDF: https://…")
const RE_FIELD = /^([A-ZÀ-Ú][A-Za-zÀ-ú.\/ ]{1,32}?)\s*:\s*(\S.{0,150})?$/;
function fieldAt(t) {
  const m = String(t || '').match(RE_FIELD);
  if (!m || wordsOf(m[1]).length > 4) return null;
  const v = (m[2] || '').trim();
  if (v && (splitSentences(v).length > 1 || (v.length > 90 && /[.!?]$/.test(v)))) return null;
  return { rotulo: m[1].trim(), valor: v };
}
const SUB_MARK = '\u0001SUB\u0001';

function isCapsLine(t) {
  if (t.length < 4 || t.length > 100) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 4) return false;
  const up = letters.replace(/[^A-ZÀ-Ý]/g, '').length;
  return up / letters.length >= 0.85 && !/\d{2}[\/.]\d{2}/.test(t);
}
const DOC_TITLE_RE = /^(?:ata\b|universidade|ministerio|colegiado|reuniao\s+(?:ordinaria|extraordinaria)|curso\s+de|instituto|centro\s+de|faculdade|escola|\d+\s*[ªa]?\s*reuniao)/;

function buildStructure(text, layout) {
  const s = buildStructureLines(text, layout);
  if (s.tipo === 'corrido' && s.pauta) {
    const seg = segmentFlatByPauta(text, s.pauta);
    if (seg) {
      const s2 = buildStructureLines(seg, layout);
      if (s2.tipo === 'numerada') { s2.segmentado = true; return s2; }
    }
  }
  return s;
}

function buildStructureLines(text, layout) {
  const lines = text.split('\n');
  const N = lines.length;
  const info = lines.map(l => { const t = l.trim(); return { t, n: fold(t) }; });
  // linhas destacadas no PDF (negrito / fonte maior): pista de título, nunca prova sozinha
  const styled = new Set(((layout && layout.destaques) || []).map(d => hfKey(d.texto)));
  info.forEach(x => { if (x.t && styled.has(hfKey(x.t))) x.destaque = true; });
  const pauta = findPauta(info);
  const skip = new Array(N).fill(false);
  if (pauta && pauta.from >= 0) for (let i = pauta.from; i <= pauta.to; i++) skip[i] = true;
  const region = markRegions(info);

  // ---- candidatos a cabeçalho ----
  const numCands = [], capsCands = [], colonCands = [], titleCands = [], styleCands = [];
  const firstBody = info.findIndex(x => x.t.length >= 60);       // antes disso é cabeçalho do documento
  const lengths = info.filter(x => x.t).map(x => x.t.length).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 80;
  let actionLabelUntil = -1;
  for (let i = 0; i < N; i++) {
    const t = info[i].t;
    if (!t || skip[i] || region[i]) continue;
    if (/\||\t/.test(t)) continue;
    if (/^(?:encaminhamentos?|providencias|acoes|pendencias|tarefas|proximos\s+passos|decisoes?|deliberacoes?)\s*[:\-–]/.test(info[i].n)) actionLabelUntil = i + 8;
    let m = t.match(RE_NUM_HEAD) || null, num = null, text0 = null, kind = null;
    if (m) { num = +m[1]; text0 = m[2]; kind = 'num'; }
    else if ((m = t.match(RE_ITEM))) { num = +m[1]; text0 = m[2] || ''; kind = 'item'; }
    else if ((m = t.match(RE_ROMAN_HEAD)) && romanValue(m[1]) != null) { num = romanValue(m[1]); text0 = m[2]; kind = 'roman'; }
    else if ((m = t.match(RE_OCR_ROMAN)) && /[IVX]/.test(m[1]) && /[l1|]/.test(m[1]) && romanValue(m[1].replace(/[l1|]/g, 'I')) != null) {
      num = romanValue(m[1].replace(/[l1|]/g, 'I')); text0 = m[2]; kind = 'roman';      // OCR leu "II" como "1I"/"Il"
    }
    if (kind) {
      const looksAction = ACT_INF_START.test(text0) && i <= actionLabelUntil;
      if (!looksAction) {
        let prevIdx = i - 1; while (prevIdx >= 0 && skip[prevIdx]) prevIdx--;
        const mc = mergeHeadingContinuation(info, i, text0);
        numCands.push({ i, num, text: mc.text, kind, consumed: mc.consumed, rest: mc.rest, blankBefore: prevIdx < 0 || !info[prevIdx].t, destaque: !!info[i].destaque });
      }
      continue;
    }
    if (info[i].destaque && i > firstBody && firstBody >= 0 && t.length <= 100 && !/[.;,]$/.test(t) && !DOC_TITLE_RE.test(info[i].n) &&
        !/^(?:https?:\/\/|www\.)/i.test(t) && !RE_LIST.test(t) && !/^\(?[a-z]\s*[).]\s/.test(t)) styleCands.push({ i, text: t.replace(/:$/, '') });
    if (isCapsLine(t) && !DOC_TITLE_RE.test(info[i].n) && !/^(?:presentes|ausentes|assinaturas?)$/.test(info[i].n)) { capsCands.push({ i, text: t }); continue; }
    if (/^[A-ZÀ-Ú][^.!?]{2,80}:$/.test(t) && !/^(?:pauta|ordem|presentes|ausentes|encaminhamentos?|decis[õo]es|delibera[çc][õo]es)/i.test(t)) { colonCands.push({ i, text: t.replace(/:$/, '') }); continue; }
    // título provável: linha curta, sem pontuação final, entre blocos
    const prev = i > 0 ? info[i - 1].t : '';
    let nextIdx = i + 1; while (nextIdx < N && !info[nextIdx].t) nextIdx++;
    const next = nextIdx < N ? info[nextIdx].t : '';
    if (t.length <= 70 && t.length <= median * 0.7 && !/[.;,!?:]$/.test(t) && /^[A-ZÀ-Ú]/.test(t) &&
        wordsOf(t).length >= 1 && wordsOf(t).length <= 9 && (!prev || /[.!?:;]$/.test(prev)) &&
        next.length >= 60 && !DOC_TITLE_RE.test(info[i].n) && !RE_LIST.test(t) && i > 2 &&
        !/^(?:prof|profa|dr|dra)\b/i.test(t) && !/\d{2}[\/.]\d{2}/.test(t)) {
      titleCands.push({ i, text: t });
    }
  }

  // ---- escolhe o tipo de estrutura ----
  const accepted = chooseNumberedChain(numCands, pauta ? pauta.items : []);
  let tipo = 'corrido', heads = [];
  if (accepted.length >= 2 || (accepted.length === 1 && pauta)) {
    tipo = 'numerada';
    heads = accepted.map(c => ({ i: c.i, num: c.num, raw: c.text, rest: c.rest, consumed: c.consumed, origem: 'item numerado', conf: 0.9 }));
    heads.forEach(h => h.consumed.forEach(j => { skip[j] = true; }));
  } else if (styleCands.length >= 2) {
    tipo = 'titulos';
    heads = styleCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'título em destaque (negrito ou fonte maior)', conf: 0.82 }));
  } else if (capsCands.length >= 2) {
    tipo = 'titulos';
    heads = capsCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'cabeçalho em maiúsculas', conf: 0.8 }));
  } else if (colonCands.length >= 2) {
    tipo = 'titulos';
    heads = colonCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'título seguido de dois-pontos', conf: 0.7 }));
  } else if (titleCands.length >= 2) {
    tipo = 'titulos';
    heads = titleCands.map(c => ({ i: c.i, num: null, raw: c.text, origem: 'título provável', conf: 0.55 }));
  }

  // ---- monta blocos ----
  const pautaByNum = new Map();
  if (pauta) pauta.items.forEach(it => { if (!pautaByNum.has(it.num)) pautaByNum.set(it.num, it.title); });
  const headAt = new Map(heads.map(h => [h.i, h]));
  const blocks = [];
  let cur = { title: null, origem: null, conf: 0, num: null, lines: [], kind: 'abertura' };
  for (let i = 0; i < N; i++) {
    if (skip[i]) continue;
    if (region[i]) { if (cur.lines.length || cur.title) { blocks.push(cur); } cur = { title: null, origem: null, conf: 0, num: null, lines: [], kind: region[i] }; /* região ignorada */ continue; }
    if (cur.kind === 'presenca' || cur.kind === 'encerramento') { cur = { title: null, origem: null, conf: 0, num: null, lines: [], kind: 'texto' }; }
    const h = headAt.get(i);
    if (h) {
      blocks.push(cur);
      let title = null, body = '', origem = h.origem, conf = h.conf;
      if (h.raw) {
        const [tt, bb] = (tipo === 'numerada') ? splitTitleBody(h.raw) : [h.raw, ''];
        title = cleanTitle(tt); body = bb || '';
        if (tipo === 'numerada' && h.num != null && pautaByNum.has(h.num)) {
          const pt = pautaByNum.get(h.num);
          // O título do cabeçalho é preservado; a pauta só o substitui quando ele está ausente,
          // é um TRUNCAMENTO do título da pauta, ou é na verdade uma frase de corpo.
          const ft = title ? fold(title).replace(/[^a-z0-9]+/g, ' ').trim() : '';
          const fp = fold(pt).replace(/[^a-z0-9]+/g, ' ').trim();
          if (!title || (fp.startsWith(ft) && fp.length > ft.length) || (wordsOf(tt || '').length > 12 && titleSim(title, pt) < 0.5)) {
            if (title && !fp.startsWith(ft) && tt) body = squash(h.raw);      // era frase de corpo: não perde o texto
            title = pt;
          }
          origem = 'pauta + item numerado';
          conf = 0.95;
        }
      } else if (h.num != null && pautaByNum.has(h.num)) { title = pautaByNum.get(h.num); origem = 'pauta + item numerado'; conf = 0.95; }
      const lines0 = [];
      if (body) lines0.push(body);
      if (h.rest) lines0.push(h.rest);                       // corpo que vinha depois do título quebrado
      cur = { title, origem: title ? origem : null, conf: title ? conf : 0, num: h.num, lines: lines0, kind: 'assunto' };
      // posição do cabeçalho no texto (usada pela leitura formatada; não enumerável → não vai para o JSON)
      Object.defineProperty(cur, 'head', { value: { line: i, consumed: h.consumed || [], body: lines0.slice() }, enumerable: false });
      continue;
    }
    const sh = cur.kind === 'assunto' ? subHeadingAt(info, i) : null;
    cur.lines.push(sh ? SUB_MARK + sh.titulo : info[i].t);   // subtítulo: marcador interno, nunca vira texto
  }
  blocks.push(cur);
  return { tipo, pauta, blocks: blocks.filter(b => b.lines.some(Boolean) || b.title), rawLines: info, region };
}

/* Escolhe a SEQUÊNCIA de itens numerados que forma a estrutura da ata.
   Uma ata pode ter sublistas numeradas dentro de um item ("1. Discente A… 2. Discente B…"),
   e esses números não podem "roubar" o cabeçalho dos itens principais. Programação dinâmica:
   maior cadeia crescente (n → n+1, com no máximo um salto de 2), desempatada por "cara de título"
   (sem ponto final, curto, linha em branco antes) e por semelhança com o item da pauta de mesmo número. */
function chooseNumberedChain(cands, pautaItems) {
  if (!cands.length) return [];
  const pautaByNum = new Map((pautaItems || []).map(p => [p.num, p.title]));
  const quality = c => {
    const t = (c.text || '').trim();
    let q = 0;
    if (!/[.!?]$/.test(t)) q += 0.3;
    if (wordsOf(t).length <= 16) q += 0.1;
    if (c.blankBefore) q += 0.15;
    if (c.kind === 'item' || c.kind === 'roman') q += 0.1;
    if (c.destaque) q += 0.25;                         // formatado como título no PDF
    if (pautaByNum.has(c.num)) q += 0.8 * titleSim(splitTitleBody(t)[0] || t, pautaByNum.get(c.num));
    return q;
  };
  const best = cands.map(() => null);
  cands.forEach((c, k) => {
    const q = quality(c);
    let b = (c.num <= 2 || pautaByNum.has(c.num) && c.num <= 3) ? { score: 1 + q, prev: -1 } : null;
    for (let j = 0; j < k; j++) {
      if (!best[j]) continue;
      const d = c.num - cands[j].num;
      if (d !== 1 && d !== 2) continue;
      const s = best[j].score + 1 + q - (d === 2 ? 0.6 : 0);
      if (!b || s > b.score) b = { score: s, prev: j };
    }
    best[k] = b;
  });
  let end = -1;
  best.forEach((b, k) => { if (b && (end < 0 || b.score > best[end].score)) end = k; });
  const chain = [];
  for (let k = end; k >= 0; k = best[k].prev) chain.unshift(cands[k]);
  return chain;
}

/* Ata sem quebras de linha (PDF "achatado"): a pauta existe, mas os itens no corpo aparecem
   no meio do parágrafo ("... 2. Alterações em históricos (relatoria ...) O relator ...").
   Insere quebras de linha antes de cada marcador de item — na ordem da pauta — e depois do
   título quando ele é repetido literalmente. Só marca um item se o número vier seguido do
   início do título correspondente (ou de "Item N"), para não confundir com números do texto. */
function segmentFlatByPauta(text, pauta) {
  const items = pauta.items;
  if (!items || items.length < 2) return null;
  const nt = fold(text);
  // começa depois da pauta: posição do fim do último título da pauta na primeira ocorrência
  const lastT = fold(items[items.length - 1].title);
  let pos = nt.indexOf(lastT);
  if (pos < 0) return null;
  pos += lastT.length;
  const cuts = [];
  const sigWords = s => (fold(s).match(/[a-z0-9]+/g) || []);
  items.forEach(it => {
    const w = sigWords(it.title);
    if (!w.length) return;
    const lead = w.slice(0, Math.min(3, w.length)).join('[^a-z0-9]+');
    const re = new RegExp('(?:^|[\\s.;:])((?:(?:item|ponto|assunto)\\s*(?:n[ºo°.]*\\s*)?)?' + it.num + '\\s*[.)\\-–—:]\\s*)(?=' + lead + ')|(?:^|[\\s.;:])((?:item|ponto)\\s*(?:n[ºo°.]*\\s*)?' + it.num + '\\s*[.:\\-–—]\\s*)', 'g');
    re.lastIndex = pos;
    const m = re.exec(nt);
    if (!m) return;
    const at = m.index + m[0].length - (m[1] || m[2]).length;
    // fim do título repetido literalmente?
    const tf = fold(it.title).replace(/\s+/g, ' ');
    const after = nt.slice(at + (m[1] || m[2]).length);
    let titleEnd = -1;
    if (after.replace(/\s+/g, ' ').startsWith(tf)) {
      let k = 0, c = 0;
      while (k < after.length && c < tf.length) { if (/\s/.test(after[k]) && /\s/.test(tf[c])) { while (k < after.length && /\s/.test(after[k])) k++; c++; } else { k++; c++; } }
      titleEnd = at + (m[1] || m[2]).length + k;
    }
    cuts.push({ at, titleEnd });
    pos = Math.max(at + 1, titleEnd);
  });
  if (cuts.length < 2) return null;
  let out = '', last = 0;
  cuts.forEach(c => {
    out += text.slice(last, c.at).replace(/\s+$/, '') + '\n\n';
    if (c.titleEnd > 0) { out += text.slice(c.at, c.titleEnd).trim() + '\n'; last = c.titleEnd; }
    else last = c.at;
  });
  return out + text.slice(last).replace(/^\s+/, '');
}

/* ============================================================
   TERMOS TEMPORAIS — "PRAZO OU REFERÊNCIA TEMPORAL"
============================================================ */
const PREP_T = String.raw`(?:ate|durante|ao\s+longo\s+d[oa]|no\s+decorrer\s+d[oa]|em|no|na|ao|para\s+o|para\s+a|a\s+partir\s+d[oa]|antes\s+d[oa]|apos\s+o|apos\s+a|depois\s+d[oa]|desde\s+o|desde\s+a|por\s+todo\s+o)`;
const PERIOD_MOD = String.raw`(?:proxim[oa]s?|ultim[oa]|seguinte|presente|atual|corrente|este|esse|esta|essa|primeiro|segundo|terceiro|(?:1|2)\s*[ºo])`;
const EDGE = String.raw`(?:inicio|final|fim|meio|metade|termino|encerramento|comeco|decorrer)`;
const EVT_HEAD = String.raw`(?:prova|provas|avaliacao|avaliacoes|exame|exames|evento|eventos|semana\s+academica|congresso|seminario|jornada|colacao\s+de\s+grau|formatura|matricula|rematricula|periodo\s+de\s+matricula|inscricoes?|vestibular|enade|defesa|defesas|banca|bancas|feriado|recesso|ferias|greve|calendario|aprovacao|votacao|homologacao|publicacao|divulgacao|resultado|edital|visita|viagem|oficina|palestra|minicurso|mostra|feira|encontro|aula\s+inaugural|inicio\s+das\s+aulas|inicio\s+do\s+semestre|termino\s+do\s+semestre|fim\s+do\s+semestre|entrega|renovacao|credenciamento|processo\s+seletivo|selecao|concurso|chamada|conclusao|encerramento|abertura|retomada|retorno|implantacao|implementacao|execucao|realizacao|aplicacao)`;
const NOMINAL = String.raw`(?:realizacao|aplicacao|conclusao|divulgacao|publicacao|apresentacao|entrega|abertura|inicio|termino|fim|encerramento|aprovacao|homologacao|retorno|oferta|elaboracao|finalizacao|implantacao|implementacao|execucao)`;

const T_PATTERNS = [
  { tipo: 'data', kind: 'full', re: /(?:^|[^\d\/.\-])(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})(?![\d\/])/g },
  { tipo: 'data', kind: 'full2', re: /(?:^|[^\d\/.\-])(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2})(?![\d\/])/g },
  { tipo: 'data', kind: 'txt', re: rx('g')`(\d{1,2}\s*(?:º|o)?\s+de\s+(?:${MES_F})(?:\s+(?:de|do\s+ano\s+de)\s+\d{4})?)` },
  { tipo: 'data', kind: 'dm', re: /(?:^|[^\d\/.\-])(\d{1,2}\/\d{1,2})(?![\d\/])/g },
  { tipo: 'periodo', kind: 'mesano', re: rx('g')`\b((?:(?:no\s+)?mes\s+de\s+)?(?:${MES_F})\s+(?:de|do\s+ano\s+de)\s+\d{4})\b` },
  { tipo: 'periodo', kind: 'mes', re: rx('g')`\b((?:em|ate|no\s+mes\s+de|durante|a\s+partir\s+de|ate\s+o\s+(?:fim|final)\s+de|antes\s+de|apos|desde|ao\s+longo\s+de|no\s+inicio\s+de|no\s+final\s+de|na\s+primeira\s+quinzena\s+de|na\s+segunda\s+quinzena\s+de)\s+(?:o\s+mes\s+de\s+)?(?:${MES_F}))\b(?!\s+(?:de|do)\s+\d)` },
  { tipo: 'periodo', kind: 'sem', re: /(?:^|[^\d\/.\-])((?:20\d{2})[.\/-][12])(?!\d)/g },
  { tipo: 'periodo', kind: 'relA', re: rx('g')`\b(${PREP_T}\s+(?:(?:o|a)\s+)?(?:${EDGE}\s+d[oa]\s+)?(?:${PERIOD_MOD}\s+)?(?:semestre(?:\s+letivo)?|periodo(?:\s+letivo)?|trimestre|bimestre|quadrimestre|calendario\s+academico|recesso|ferias)(?:\s+(?:de\s+)?20\d{2}(?:[.\/][12])?)?)\b` },
  { tipo: 'periodo', kind: 'relB', re: rx('g')`\b(${PREP_T}\s+(?:(?:o|a)\s+)?(?:(?:${EDGE}\s+d[oa]\s+(?:${PERIOD_MOD}\s+)?)|(?:${PERIOD_MOD}\s+))(?:ano(?:\s+letivo)?|mes)(?:\s+(?:de\s+)?20\d{2})?)\b` },
  { tipo: 'periodo', kind: 'ano', re: /\b((?:em|ate|para|durante|no\s+ano\s+de|ate\s+o\s+(?:final|fim)\s+de|ao\s+longo\s+de|a\s+partir\s+de|desde|antes\s+de|apos)\s+20\d{2})\b(?![\/.\-]\d)/g },
  { tipo: 'periodo', kind: 'dur', re: /\b((?:em|dentro\s+de|no\s+prazo\s+de|no\s+maximo|ate|apos|depois\s+de)\s+(?:cerca\s+de\s+|aproximadamente\s+)?(?:\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|sessenta|noventa)\s*(?:\([^)]*\)\s*)?(?:dias?(?:\s+uteis|\s+corridos)?|semanas?|meses|mes|anos?|horas?|quinzenas?))\b/g },
  { tipo: 'periodo', kind: 'prox', re: rx('g')`\b((?:nas|nos|na|no|nesta|neste|nessa|nesse|ate\s+a|ate\s+o|ate\s+as|ate\s+os)\s+(?:proxim[oa]s?|ultim[oa]s?|seguintes?)\s+(?:\d+\s+)?(?:semanas?|dias?(?:\s+uteis)?|meses|mes|quinzenas?|anos?)(?:\s+d[eo]\s+(?:${MES_F}|20\d{2}))?)\b` },
  { tipo: 'data', kind: 'wd', re: /\b((?:(?:na|ate\s+a|para\s+a|nesta|ate\s+esta|ate)\s+(?:proxima\s+)?(?:segunda|terca|quarta|quinta|sexta)(?:-feira)?(?!\s+(?:reuniao|vez|etapa|fase|parte|edicao|chamada|opcao|via|turma|sessao|pauta|unidade|prova|avaliacao))|(?:no|ate\s+o|neste|para\s+o|ate\s+este)\s+(?:proximo\s+)?(?:sabado|domingo)))\b/g },
  { tipo: 'reuniao', kind: 'reuA', re: /\b((?:ate|antes|apos|depois|durante|em|na|nas|para|logo\s+apos)\s+(?:a\s+|de\s+|da\s+|das\s+|o\s+)?(?:proxim[oa]s?|seguinte|futura|vindoura|subsequente)\s+(?:reuniao|reunioes|sessao|sessoes|assembleia|encontro|encontros|plenaria|oficina)(?:\s+(?:ordinarias?|extraordinarias?|gera(?:l|is)))?(?:\s+d[oa]s?\s+[\w-]+(?:\s+d[oa]s?\s+[\w-]+)?)?)/g },
  { tipo: 'reuniao', kind: 'reuB', re: rx('g')`\b((?:ate|antes\s+d[aeo]|apos|depois\s+d[aeo]|na|em|para\s+a|durante\s+a)\s+(?:a\s+)?reuniao\s+(?:seguinte|posterior|subsequente|futura|extraordinaria|de\s+(?:${MES_F}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|encerramento|avaliacao|planejamento)))` },
  { tipo: 'reuniao', kind: 'reuC', re: /\b((?:em|numa|em\s+uma)\s+(?:reuniao|sessao)\s+(?:futura|posterior|especifica|extraordinaria|especial)|em\s+nova\s+reuniao|em\s+outra\s+reuniao)\b/g },
  { tipo: 'evento', kind: 'evt', re: rx('g')`\b((?:antes|apos|depois|durante|ate|logo\s+apos|logo\s+antes|por\s+ocasiao|ao\s+final|ao\s+termino|no\s+momento|na\s+vespera|a\s+partir)\s+(?:d[aeo]s?|ao|aos|a|o|as|os|n[ao]s?)\s+(?:(?:proxim[oa]s?|ultim[oa]s?|primeir[oa]s?)\s+)?(?:${NOMINAL}\s+d[aeo]s?\s+)?${EVT_HEAD}(?:\s+d[aeo]s?\s+[\w-]+){0,2})` },
  { tipo: 'evento', kind: 'cond', re: /\b((?:assim\s+que|logo\s+que|tao\s+logo|uma\s+vez\s+(?:que\s+)?)\s*(?:\S+\s+){1,6}?)(?=[,.;]|$)/g },
  { tipo: 'indefinido', kind: 'vague', re: /\b((?:o\s+)?quanto\s+antes|com\s+urgencia|em\s+carater\s+de\s+urgencia|urgentemente|imediatamente|de\s+imediato|em\s+breve|brevemente|posteriormente|oportunamente|futuramente|a\s+curto\s+prazo|a\s+medio\s+prazo|a\s+longo\s+prazo|no\s+futuro|em\s+momento\s+oportuno|logo\s+que\s+possivel|assim\s+que\s+possivel|sem\s+demora|periodicamente|mensalmente|semestralmente|anualmente|semanalmente|regularmente|continuamente|hoje|amanha|na\s+proxima\s+semana|nesta\s+semana)\b/g }
];

const DATE_PREFIXES = ['prazo final de','prazo final:','prazo final','prazo maximo de','prazo maximo','prazo de','prazo:','prazo','data limite:','data limite de','data limite','ate o dia','ate dia','ate a data de','ate o','ate','a partir do dia','a partir de','a partir do','desde o dia','desde','antes do dia','antes de','antes do','apos o dia','apos','depois de','em','no dia','dia','para o dia','para'];

function parseDateRef(core, ctx) {
  const c = fold(core);
  let m;
  if ((m = c.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})/))) return isoOf(m[3], m[2], m[1]);
  if ((m = c.match(rx('')`(\d{1,2})\s*(?:º|o)?\s+de\s+(${MES_F})(?:\s+(?:de|do\s+ano\s+de)\s+(\d{4}))?`))) {
    let y = m[3];
    if (!y) {
      y = ctx && ctx.meetingISO ? +ctx.meetingISO.slice(0, 4) : null;
      if (y && ctx.meetingISO && MES_NUM[m[2]] < +ctx.meetingISO.slice(5, 7) - 1) y += 1;
    }
    return y ? isoOf(y, MES_NUM[m[2]], m[1]) : null;
  }
  if ((m = c.match(/^(\d{1,2})\/(\d{1,2})$/))) {
    let y = ctx && ctx.meetingISO ? +ctx.meetingISO.slice(0, 4) : null;
    if (y && +m[2] < +ctx.meetingISO.slice(5, 7) - 1) y += 1;
    return y ? isoOf(y, m[2], m[1]) : null;
  }
  return null;
}

/* Devolve { principal, refs }.  Cada ref: { texto, tipo, dataAssociada, iso, start, end }.
   Textos relativos são preservados exatamente como na ata.                    */
/* Referências ACADÊMICAS/CURRICULARES que parecem semestre mas não são prazo:
   "grade 2008/1", "ementas de 2023/2", "matriz 2023/2", "horário 2026.2", "edital 2026/1" */
const CURRICULAR_BEFORE = /(?:grades?|ementas?|matriz(?:es)?|curriculos?|horarios?|ppcs?|versao|versoes|estrutura\s+curricular|fluxogramas?|plano\s+de\s+ensino|ingressantes?|ingresso|egressos?|edital|resolucao|portaria|processo|instrucao\s+normativa|oficio|memorando|n[ºo°])\s*\.?\s*(?:curriculares?\s*)?(?:n[ºo°.]*\s*)?(?:(?:d[aeo]s?|em|na|no|para\s+a|para\s+o|apenas\s+(?:para\s+)?(?:a|o)?|somente\s+(?:para\s+)?(?:a|o)?|de\s+acordo\s+com\s+(?:a|o)|seguindo\s+(?:a|o)s?)\s+)*$/;
// Contexto TEMPORAL explícito exigido antes de 20xx/1 ou 20xx.2:
//   "em|para|até|durante|desde|após|a partir de 2026/2"  ou  "semestre|período [letivo] 2026/2"
const SEMESTER_CONTEXT = /(?:^|[^a-z])(?:(?:em|para|ate|durante|desde|apos|antes\s+de|a\s+partir\s+de|ao\s+longo\s+de|no\s+decorrer\s+de)\s+(?:o\s+|a\s+)?(?:(?:proximo|primeiro|segundo|novo|este|esse)\s+)?(?:(?:semestre|periodo)(?:\s+letivo)?\s+(?:de\s+)?)?|(?:semestre|periodo)(?:\s+letivo)?\s+(?:de\s+)?)$/;
function semesterContextOk(n, start) {
  const before = n.slice(Math.max(0, start - 45), start);
  if (CURRICULAR_BEFORE.test(before)) return -1;       // referência curricular, não temporal
  const m = before.match(SEMESTER_CONTEXT);            // sem contexto temporal explícito -> rejeita
  return m ? m[0].replace(/^[^a-z]/, '').length : -1;  // tamanho do contexto ("para ", "no semestre ")
}

function findTemporal(sentence, ctx) {
  ctx = ctx || {};
  const n = fold(sentence);
  const found = [];
  T_PATTERNS.forEach(p => {
    p.re.lastIndex = 0;
    let x;
    while ((x = p.re.exec(n))) {
      if (x[0].length === 0) { p.re.lastIndex++; continue; }
      const g = x[1];
      const coreStart = x.index + x[0].indexOf(g);
      const coreEnd = coreStart + g.length;
      let rec = { tipo: p.tipo, kind: p.kind, start: coreStart, coreStart, end: coreEnd };
      // etapa de validação contextual (antes de aceitar a referência)
      if (p.kind === 'sem') {
        const ctxLen = semesterContextOk(n, coreStart);
        if (ctxLen < 0) continue;
        rec.start = coreStart - ctxLen;                  // o prazo exibido inclui o contexto: "para 2026/2"
      }
      // semestre/período com ano explícito ANTERIOR à reunião: referência ao passado (contexto, nunca prazo)
      if (ctx.meetingISO && (p.kind === 'sem' || p.kind === 'relA')) {
        const ys = g.match(/(20\d{2})(?:[.\/-]([12]))?/);
        if (ys) {
          const my = +ctx.meetingISO.slice(0, 4), ms = +ctx.meetingISO.slice(5, 7) <= 6 ? 1 : 2;
          if (+ys[1] < my || (+ys[1] === my && ys[2] && +ys[2] < ms)) rec.passado = true;
        }
      }
      if (p.kind === 'ano' && CURRICULAR_BEFORE.test(n.slice(Math.max(0, coreStart - 45), coreStart))) continue;
      if (p.tipo === 'data' && ['full', 'full2', 'txt', 'dm'].includes(p.kind)) {
        // dd/mm solto só vale com contexto temporal e fora de numeração oficial
        if (p.kind === 'dm') {
          const before = n.slice(Math.max(0, coreStart - 24), coreStart);
          if (!/(?:ate|em|dia|para|ao|data|prazo)\s+(?:o\s+)?(?:dia\s+)?$/.test(before)) continue;
          if (/(?:n[ºo°]?|resolucao|portaria|edital|processo|lei|decreto|art|instrucao|oficio|memorando)\s*\.?\s*$/.test(before)) continue;
          const mm = g.split('/'); if (+mm[0] > 31 || +mm[1] > 12) continue;
        }
        const iso = parseDateRef(sentence.slice(coreStart, coreEnd), ctx);
        if (p.kind !== 'txt' && !iso) continue;
        rec.iso = iso;
        // estende para trás: "prazo até", "até o dia", "a partir de", "de 10 a"
        let k = coreStart, pre = n.slice(0, coreStart), guard = 0;
        const range = pre.match(/(?:de\s+)?(\d{1,2})\s+a\s+$/);
        if (range) { k = coreStart - range[0].length; pre = n.slice(0, k); }
        while (guard++ < 3) {
          let hit = null;
          for (const pf of DATE_PREFIXES) {
            if (pre.endsWith(pf + ' ') || pre.endsWith(pf)) {
              const at = pre.length - (pre.endsWith(pf + ' ') ? pf.length + 1 : pf.length);
              if (at === 0 || /[^a-z]/.test(pre[at - 1])) { hit = pf.length + (pre.endsWith(pf + ' ') ? 1 : 0); break; }
            }
          }
          if (!hit) break;
          k -= hit; pre = n.slice(0, k);
        }
        rec.start = k;
      } else if (p.kind === 'cond') {
        rec.end = coreEnd;
      }
      // referências absolutas anteriores à data da reunião são passado, não prazo
      if (rec.iso && ctx.meetingISO && rec.iso < ctx.meetingISO) continue;
      if (p.kind === 'ano') {
        const yy = +(g.match(/20\d{2}/) || [0])[0];
        if (ctx.meetingISO && yy < +ctx.meetingISO.slice(0, 4)) continue;
      }
      found.push(rec);
    }
  });

  // resolve sobreposições: começa antes e é mais longo
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const refs = [];
  found.forEach(r => {
    const last = refs[refs.length - 1];
    if (last && r.start < last.end) {
      if ((r.end - r.start) > (last.end - last.start) && r.start <= last.start) refs[refs.length - 1] = r;   // o maior vence
      return;
    }
    refs.push(r);
  });

  // data absoluta logo depois de um evento/reunião/período -> "data associada"
  const LINK = /^[\s,;:(–-]*(?:(?:que\s+)?(?:esta\s+|estara\s+|sera\s+|foi\s+)?(?:marcad|previst|agendad|programad|fixad|convocad|designad)[oa]s?\s*)?(?:(?:que\s+)?(?:ocorrera|acontecera|ocorre|acontece|sera\s+realizad[oa]|sera\s+aplicad[oa]|sera|e)\s*)?(?:para\s+|em\s+|no\s+dia\s+|dia\s+|nos\s+dias\s+|de\s+|do\s+dia\s+|na\s+data\s+de\s+|a\s+partir\s+de\s+|ate\s+)?(?:o\s+dia\s+)?$/;
  const attached = new Set();
  refs.forEach((r, i) => {
    if (r.tipo === 'data' || r.tipo === 'indefinido') return;
    const d = refs[i + 1];
    if (d && d.tipo === 'data' && d.coreStart - r.end <= 90 && LINK.test(n.slice(r.end, d.coreStart))) {
      r.dataAssociada = sentence.slice(d.coreStart, d.end).trim();
      r.iso = d.iso || null;
      attached.add(d);
    }
  });

  const out = refs.map(r => ({
    texto: squash(sentence.slice(r.start, r.end)), core: squash(sentence.slice(r.coreStart, r.end)), tipo: r.tipo,
    dataAssociada: r.dataAssociada || null, iso: r.iso || null, start: r.start, end: r.end, anexa: attached.has(r),
    ...(r.passado ? { passado: true } : {})
  }));
  const standalone = out.filter(r => !r.anexa);
  const concrete = standalone.filter(r => r.tipo !== 'indefinido');
  const principal = (concrete[0] || standalone[0]) || null;
  return { principal, refs: out };
}

/* ============================================================
   RESPONSÁVEIS  (pessoas, cargos e grupos)
   Não depende da palavra "responsável": procura o SUJEITO que
   antecede o verbo de ação e agentes explícitos ("pela secretaria",
   "cabe ao NDE", "a cargo de ...", "Responsável: ...").
============================================================ */
const NAME_TOK = /^[A-ZÀ-Ú][a-zà-úA-ZÀ-Ú'’-]+\.?$|^[A-ZÀ-Ú]\.$/;
const DET_RE = /^(?:o|a|os|as|um|uma)$/;
const PART_RE = /^(?:d[aeo]s?|di|von|van)$/;

function tokClean(tk) { return tk.replace(/^[("“]+/, '').replace(/[,;:)"”]+$/, ''); }
function isNameTok(tk) {
  const w = tokClean(tk);
  if (!NAME_TOK.test(w)) return false;
  const bare = w.replace(/\.$/, '');
  if (CAP_STOP.has(bare) || TITLE_SET.has(fold(bare))) return false;
  if (/mente$/.test(bare)) return false;
  if (bare.length > 1 && bare === bare.toUpperCase()) return ORG_ACRONYMS.has(bare);
  return true;
}

// Caminha de trás para frente a partir do verbo e junta o sintagma do sujeito.
function subjectBefore(region) {
  let r = region.replace(/\s+$/, '');
  const FILL = /\s+(?:se|tamb[eé]m|ainda|ent[aã]o|logo|j[aá]|prontamente|depois|igualmente|n[aã]o)$/i;
  while (FILL.test(r)) r = r.replace(FILL, '');
  // adjetivo/particípio logo após o núcleo ("os docentes interessados", "os alunos matriculados")
  for (let k = 0; k < 2; k++) {
    const mAdj = r.match(/^(.*\S)\s+([a-zà-ú]+(?:ad[oa]s?|id[oa]s?|antes?|entes?|ivos?|ivas?))$/);
    if (!mAdj) break;
    const prevTok = fold(tokClean(mAdj[1].split(/\s+/).pop()));
    if (ACTOR_SET.has(fold(mAdj[2])) || !ACTOR_SET.has(prevTok)) break;   // só remove adjetivo que segue um núcleo
    r = mAdj[1];
  }
  const toks = r.split(/\s+/).filter(Boolean);
  let e = toks.length - 1;
  const got = [];
  let entity = false;
  // complemento final: "... coordenação [do curso de Pedagogia]"
  for (let len = 1; len <= 3 && !got.length; len++) {
    const dIdx = e - len + 1;
    if (dIdx >= 1 && PART_RE.test(fold(toks[dIdx])) && ACTOR_SET.has(fold(tokClean(toks[dIdx - 1])))) {
      for (let k = e; k >= dIdx; k--) got.unshift(toks[k]);
      e = dIdx - 1; break;
    }
  }
  while (e >= 0) {
    const tk = toks[e];
    const f = fold(tokClean(tk));
    const right = got.length ? fold(tokClean(got[0])) : null;
    const rightIsDetOrNoun = right && (DET_RE.test(right) || ACTOR_SET.has(right) || TITLE_SET.has(right.replace(/\.$/, '')));
    if (ACTOR_SET.has(f)) { got.unshift(tk); entity = true; e--; continue; }
    if (TITLE_SET.has(f.replace(/\.$/, ''))) { got.unshift(tk); e--; continue; }
    if (isNameTok(tk) && !rightIsDetOrNoun) { got.unshift(tk); entity = true; e--; continue; }
    if (PART_RE.test(f) && got.length && e > 0 && isNameTok(toks[e - 1])) { got.unshift(tk); e--; continue; }
    if ((f === 'e' || f === 'ou') && got.length && e > 0 && (isNameTok(toks[e - 1]) || ACTOR_SET.has(fold(tokClean(toks[e - 1]))))) { got.unshift(tk); e--; continue; }
    if (DET_RE.test(f) && got.length) { got.unshift(tk); e--; continue; }
    break;
  }
  if (!entity) return null;
  // sintagma logo após preposição é COMPLEMENTO, não sujeito: "reprovados em Álgebra",
  // "nas próximas reuniões do Colegiado", "reunião com a coordenação"
  if (e >= 0 && /^(?:em|de|do|da|dos|das|para|por|com|sem|sobre|no|na|nos|nas|ao|aos|a|as|pelo|pela|pelos|pelas|entre|ate|apos|junto|perante|contra)$/.test(fold(tokClean(toks[e])))) return null;
  return got.join(' ');
}

function forwardPhrase(str) {
  const toks = String(str).replace(/[.!?]+\s*$/, '').trim().split(/\s+/).filter(Boolean).slice(0, 14);
  const got = [];
  let entity = false, i = 0;
  while (i < toks.length) {
    const tk = toks[i], f = fold(tokClean(tk));
    const prevEndsComma = got.length && /,$/.test(got[got.length - 1]);
    if (DET_RE.test(f) && (got.length === 0 || prevEndsComma || fold(got[got.length - 1]) === 'e')) { got.push(tk); i++; continue; }
    if (ACTOR_SET.has(f)) {
      got.push(tk); entity = true; i++;
      // complemento: "coordenação do curso (de X)"
      if (i + 1 < toks.length && PART_RE.test(fold(toks[i])) && /^(?:curso|colegiado|departamento|centro|instituto|escola|setor|nucleo|unidade)$/.test(fold(tokClean(toks[i + 1])))) {
        got.push(toks[i], toks[i + 1]); i += 2;
        if (i + 1 < toks.length && PART_RE.test(fold(toks[i])) && NAME_TOK.test(tokClean(toks[i + 1]))) { got.push(toks[i], toks[i + 1]); i += 2; }
      }
      continue;
    }
    if (TITLE_SET.has(f.replace(/\.$/, ''))) { got.push(tk); i++; continue; }
    if (isNameTok(tk)) { got.push(tk); entity = true; i++; continue; }
    if (PART_RE.test(f) && got.length && i + 1 < toks.length && isNameTok(toks[i + 1])) { got.push(tk); i++; continue; }
    if ((f === 'e' || f === 'ou') && got.length && i + 1 < toks.length && (isNameTok(toks[i + 1]) || ACTOR_SET.has(fold(tokClean(toks[i + 1]))) || DET_RE.test(fold(toks[i + 1])))) { got.push(tk); i++; continue; }
    break;
  }
  return entity ? got.join(' ') : null;
}

function startsEntity(tk) {
  const f = fold(tokClean(tk)).replace(/\.$/, '');
  return DET_RE.test(f) || ACTOR_SET.has(f) || TITLE_SET.has(f) || isNameTok(tk);
}

/* Separa por vírgula, "e" e "ou" (só quando o que vem depois abre OUTRA entidade).
   "ou" marca ALTERNATIVA: cada entidade ligada por "ou" recebe alt:true e o texto
   final preserva a conjunção ("Coordenação ou Direção"). */
function parseEntities(phrase, known) {
  const allToks = String(phrase).trim().split(/\s+/).filter(Boolean);
  const parts = [], seps = [];
  let cur = [];
  allToks.forEach((tk, i) => {
    const f = fold(tokClean(tk));
    const next = allToks[i + 1];
    if ((f === 'e' || f === 'ou') && cur.length && next && startsEntity(next)) { parts.push(cur); seps.push(f); cur = []; return; }
    cur.push(tk);
    if (/,$/.test(tk) && next) { parts.push(cur); seps.push(','); cur = []; }
  });
  if (cur.length) parts.push(cur);

  const out = [];
  parts.forEach((ptoks, pi) => {
    const toks = ptoks.map(tokClean).filter(Boolean);
    let cargo = null; const nameToks = []; const groupToks = [];
    let inName = false;
    toks.forEach(tk => {
      const f = fold(tk);
      if (!inName && DET_RE.test(f)) return;
      if (!inName && TITLE_SET.has(f.replace(/\.$/, ''))) { cargo = cargo || ({ prof: 'Professor', profa: 'Professora', professor: 'Professor', professora: 'Professora', dr: 'Dr.', dra: 'Dra.', sr: 'Sr.', sra: 'Sra.' }[f.replace(/\.$/, '')] || cap1(tk)); return; }
      if (!inName && ACTOR_SET.has(f)) { groupToks.push(tk); if (ROLE_SET.has(f) && !cargo) cargo = cap1(tk); return; }
      // "Comissão de Estágio", "Coordenação do Curso de Física": maiúscula após "de/do/da" que segue
      // um órgão/cargo é COMPLEMENTO do nome do órgão, não nome de pessoa
      if (!inName && groupToks.length && PART_RE.test(fold(groupToks[groupToks.length - 1])) &&
          groupToks.some(g => ACTOR_SET.has(fold(g))) && isNameTok(tk)) { groupToks.push(tk); return; }
      if (isNameTok(tk)) { inName = true; nameToks.push(tk); return; }
      if (PART_RE.test(f)) { (inName ? nameToks : groupToks).push(tk); return; }
      if (!inName) groupToks.push(tk);
    });
    while (nameToks.length && PART_RE.test(fold(nameToks[nameToks.length - 1]))) nameToks.pop();
    const sepBefore = pi > 0 ? seps[pi - 1] : null;
    if (nameToks.length) {
      let nome = nameToks.join(' ').replace(/\.$/, m => (nameToks.length === 1 && nameToks[0].length === 2) ? m : '');
      if (known && known.length && nameToks.length === 1) {
        const hits = known.filter(k => fold(k.split(/\s+/)[0]) === fold(nome));
        if (hits.length === 1) nome = hits[0];
      }
      out.push({ nome, cargo: cargo && !ACTOR_SET.has(fold(nome)) ? cargo : null, tipo: 'pessoa', sepBefore });
    } else if (groupToks.length) {
      const g = squash(groupToks.join(' '));
      if (g) out.push({ nome: cap1(g), cargo: null, tipo: entityTipo(groupToks), sepBefore });
    }
  });
  out.forEach((e, i) => { if (e.sepBefore === 'ou' || (out[i + 1] && out[i + 1].sepBefore === 'ou')) e.alt = true; });
  const seen = new Set();
  return out.filter(o => { const k = fold(o.nome); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Retorna [{nome,cargo,tipo}]
// opts.pastAgent: aceita agente da passiva no PASSADO ("foi encaminhado pela coordenação") — só para
// encaminhamentos já efetuados e nunca para papel genérico. Em decisões, "foi aprovado pelo colegiado"
// indica QUEM DELIBEROU, e "o pedido foi feito pelo discente" indica QUEM PEDIU: nenhum dos dois é responsável.
const RE_FUT_PASSIVE = /\b(?:sera|serao|devera|deverao|ficara|ficarao|ira|irao|vai|vao|precisara|precisarao|a\s+ser(?:em)?|deve(?:m)?\s+ser|tera(?:o)?\s+(?:que|de)\s+ser)\b/;
function extractActors(orig, n, cueStart, ctx, explicitOnly, opts) {
  opts = opts || {};
  const known = ctx.participantes || [];
  let m;
  // 1. rótulo "Responsável: X, Y"
  if ((m = n.match(/respons[a-z]*\s*[:\-–]\s*/))) {
    const after = orig.slice(m.index + m[0].length).replace(/[.;].*$/, '');
    const ents = parseEntities(after.replace(/\bprazo\b.*$/i, ''), known).filter(Boolean);
    if (ents.length) return ents;
  }
  // 2. agente explícito
  const expl = [
    /\ba\s+cargo\s+d[aeo]s?\s+/, /\bsob\s+(?:a\s+)?responsabilidade\s+d[aeo]s?\s+/,
    /\b(?:cabe|cabera|caberao|compete|competira|competirao|incumbe|incumbira)\s+(?:a|ao|aos|as)\s+/
  ];
  for (const re of expl) {
    if ((m = n.match(re))) {
      const ph = forwardPhrase(orig.slice(m.index + m[0].length));
      if (ph) { const ents = parseEntities(ph, known); if (ents.length) return ents; }
    }
  }
  // 3. agente da passiva: "será enviado pela secretaria"
  const base = cueStart >= 0 ? cueStart : 0;
  const pel = n.slice(base).match(/\bpel[ao]s?\s+/);
  if (pel) {
    const at = base + pel.index + pel[0].length;
    const verbZone = n.slice(Math.max(0, base - 30), base + pel.index);
    const future = RE_FUT_PASSIVE.test(verbZone);
    const ph = forwardPhrase(orig.slice(at));
    if (ph && (future || opts.pastAgent)) {
      let ents = parseEntities(ph, known);
      if (!future) ents = ents.filter(e => e.tipo !== 'papel');
      if (ents.length) return ents;
    }
  }
  if (explicitOnly || cueStart < 0) return [];
  // 4. sujeito antes do verbo
  const pre = orig.slice(0, cueStart);
  const segs = pre.split(/(?:[;:]|\bque\b|,\s+(?:e\s+|mas\s+)?(?:ent[aã]o\s+)?)/i).map(x => x.trim());
  let tried = 0;
  for (let i = segs.length - 1; i >= 0 && tried < 3; i--) {
    if (!segs[i]) continue;
    tried++;
    const ph = subjectBefore(segs[i]);
    if (ph) { const ents = parseEntities(ph, known); if (ents.length) return ents; }
    if (i === segs.length - 1 && tried === 1 && segs[i].split(/\s+/).length > 6) break;
  }
  return [];
}

/* ============================================================
   CLASSIFICAÇÃO LINGUÍSTICA DE SENTENÇAS
   Cada sentença recebe pontuações independentes (0–1) para:
   decisão · encaminhamento · sugestão/proposta · problema · demanda.
   Palavras isoladas ("aprovar") nunca bastam: é preciso uma
   ESTRUTURA (foi + particípio, verbo + "-se", sujeito + verbo
   deliberativo, resultado de votação...).
============================================================ */
const DEC_PART = String.raw`(?:(?:aprovad|reprovad|deferid|indeferid|homologad|acordad|decidid|definid|deliberad|estabelecid|aceit|rejeitad|negad|autorizad|acatad|mantid|referendad|ratificad|consensuad|pactuad|convalidad|combinad|acertad|ajustad|escolhid|eleit|nomead|vetad|recusad|acolhid|concedid|adiad|prorrogad|cancelad|arquivad)[oa]s?|suspens[oa]s?)`;
const DEC_STRONG_PART = /(?:decidid|definid|acordad|combinad|deliberad|estabelecid|consensuad|pactuad|acertad)/;
const RE_FRAME = rx('g')`\b(?:foi|foram|ficou|ficaram|fica|ficam)\s+((?:\S+\s+){0,3}?)(${DEC_PART})\b`;
const RE_START_PART = /^(?:aprovad|reprovad|deferid|indeferid|homologad|rejeitad|aceit|acatad|negad|autorizad|mantid)[oa]s?\b/;
const RE_SE = /\b(?:decidiu|aprovou|deliberou|definiu|acordou|resolveu|determinou|estabeleceu|homologou|deferiu|indeferiu|rejeitou|aceitou|autorizou|ratificou|referendou|optou|consensuou|combinou|reprovou|acatou|vetou|decidiram|aprovaram|deliberaram|definiram|acordaram|resolveram|rejeitaram|aceitaram|deferiram|indeferiram|homologaram|autorizaram|optaram)-se\b/;
const RE_AGENT = /\b(?:decidiu|decidiram|deliberou|deliberaram|definiu|definiram|acordou|acordaram|aprovou|aprovaram|reprovou|reprovaram|rejeitou|rejeitaram|aceitou|aceitaram|acatou|acataram|deferiu|deferiram|indeferiu|indeferiram|homologou|homologaram|autorizou|autorizaram|ratificou|ratificaram|referendou|referendaram|optou|optaram|estabeleceu|estabeleceram|decidimos|deliberamos|definimos|acordamos|aprovamos|optamos)\b(?!-se)/;
const RE_CONCORD = /\b(?:concordou|concordaram|concordamos|consentiu|consentiram|determinou|determinaram)\b/;
const RE_COLLECTIVE = /\b(?:todos|todas|unanimemente|os\s+presentes|os\s+membros|o\s+colegiado|o\s+grupo|a\s+plenaria|o\s+conselho|a\s+assembleia|por\s+unanimidade|por\s+maioria|o\s+nde|a\s+comissao)\b/;
const RE_CONSENSO = /\bchegou-se\s+(?:a|ao)\s+(?:um\s+)?consenso\b|\bhouve\s+consenso\b/;
const RE_VOTE = /\bpor\s+(?:unanimidade|maioria)\b|\bcom\s+(?:\d+|uma|um|duas|dois|tres|quatro|cinco|\w+)\s+(?:\(\w+\)\s+)?(?:abstenc\w+|votos?\s+contrari\w+)|\b(?:\d+|uma|duas|dois|tres)\s+abstenc\w+|\b(?:\d+|\w+)\s+votos?\s+(?:favoravei?s?|contr\w+|a\s+favor)|\bcolocad[oa]s?\s+em\s+votacao\b|\bem\s+votacao\b|\bapos\s+votacao\b|\bresultado\s+da\s+votacao\b|\bsem\s+objecoes?\b|\bsem\s+votos?\s+contrari/;
const RE_VOTE_START = /^(?:por\s+(?:unanimidade|maioria)(?:\s+(?:simples|absoluta|dos\s+votos|dos\s+presentes))?|com\s+\w+\s+votos?\s+\w+|sem\s+objecoes?)\b/;
const RE_REF_A = rx('g')`\b(?:conforme|como|segundo|de\s+acordo\s+com|nos\s+termos\s+d[aeo]s?|previst[oa]\s+n[aeo]s?|ja\s+(?:foi|foram|havia|haviam)|havia(?:m)?\s+sido|tinha(?:m)?\s+sido|anteriormente)\b(?:\S+\s+){0,6}?${DEC_PART}\b`;
const RE_REF_B = rx('g')`${DEC_PART}\s+(?:\S+\s+){0,4}?(?:n[ao]|em|durante)\s+(?:\S+\s+){0,2}?(?:reuniao|sessao|assembleia)\s+(?:anterior|passada|de\s+(?:\d|${MES_F}))`;
const RE_HEDGE = /\b(?:ainda\s+nao|a\s+ser\s+(?:aprovad|definid|decidid|deliberad)\w*|sera\s+(?:aprovad|definid|decidid|submetid|deliberad)\w*|a\s+(?:definir|decidir|deliberar|aprovar)|em\s+(?:discussao|analise|tramitacao|andamento)|aguard\w+|pendente|nao\s+ha\s+previsao|talvez|possivelmente|provavelmente|eventualmente|poderia|poderiam|gostaria|gostariam)\b/;
const RE_COND = /\b(?:caso|se\s+for|se\s+forem|se\s+houver|quando\s+for|uma\s+vez\s+aprovad\w*|desde\s+que)\b/;
const RE_STUDENT = /\b(?:alunos?|alunas?|estudantes?|discentes?|candidat[oa]s?|turma|formandos?|ingressantes?)\b/;
const RE_NOT_STUDENT_OBJ = /\b(?:proposta|pedido|solicitacao|requerimento|projeto|plano|calendario|ata|relatorio|parecer|ppc|matriz|regulamento|resolucao|edital|minuta|documento|reformulacao|alteracao|ementa|criacao|inclusao|exclusao|oferta|convenio|planejamento|programacao|carga|horario|quadro|distribuicao|proposicao|mocao|nome|indicacao|equivalencia|aproveitamento|prorrogacao|credenciamento|descredenciamento|afastamento|licenca)\b/;

const RE_PROP_VERB = /\b(?:sugeriu|sugeriram|sugere|sugerem|sugeria|propos|propoe|propuseram|propoem|propunha|recomendou|recomendaram|recomenda|recomendam|cogitou|cogitaram|ponderou|ponderaram|levantou\s+a\s+possibilidade|levantaram\s+a\s+possibilidade|opinou|opinaram|defendeu|defenderam|sugeriu-se|propos-se|recomenda-se|cogitou-se|sugere-se|propoe-se|ponderou-se|foi\s+(?:sugerid|propost|recomendad|cogitad|ponderad)[oa]|apresentou\s+(?:a|uma|duas|tres|algumas)?\s*(?:proposta|sugestao|ideia|alternativa|opcao)|apresentaram\s+(?:\w+\s+)?(?:proposta|sugestao|ideia|alternativa)|foi\s+apresentad[oa]\s+(?:a\s+|uma\s+)?(?:proposta|sugestao|ideia|alternativa))\b/;
const RE_PROP_MODAL = /\b(?:seria\s+(?:interessante|importante|necessario|recomendavel|bom|melhor|possivel|viavel|ideal|oportuno|valido|util)|poderia(?:m)?|poderiamos|poder-se-ia|talvez|e\s+possivel\s+(?:que|\w+r\b)|possibilidade\s+de|vale\s+a\s+pena|que\s+tal|a\s+ideia\s+(?:e|seria)|avaliar\s+a\s+possibilidade|estudar\s+a\s+possibilidade|pensar\s+em)\b/;
const RE_PROPOSAL_FORMAL = /\b(?:proposta|projeto|minuta)\b/;

const RE_DISCUSS = /\b(?:discuti(?:u|ram)|discutiu-se|discutiram-se|debate(?:u|ram)|debatid[oa]s?|discutid[oa]s?|discussao|discussoes|conversou|conversaram|dialogou|analisou-se|analisaram|analisad[oa]s?|apresentou|apresentaram|apresentad[oa]s?|relatou|relataram|informou|informaram|esclareceu|esclareceram|expos|expuseram|explanou|comentou|questionou|abordou|abordaram|abordad[oa]s?|tratou-se|trataram-se|foi\s+tratad[oa])\b/;

// ---- problemas e demandas ----
const RE_PROB_CUE = /\b(?:problema[s]?|problematic[oa]s?|dificuldade[s]?|dificil|dificeis|reclamac(?:ao|oes)|reclamou|reclamaram|queixa[s]?|queixou-se|queixaram-se|preocupac(?:ao|oes)|preocupad[oa]s?|preocupante[s]?|falta\s+de|ausencia\s+de|carencia|insuficien\w+|deficit|deficiencia[s]?|evas\w+|evadi\w+|retencao|reprovacoes?|infrequencia|desist\w+|atraso[s]?|atrasad[oa]s?|inadequad[oa]s?|inexistente[s]?|impossibilidade|impedimento[s]?|entrave[s]?|gargalo[s]?|limitac(?:ao|oes)|insatisfac(?:ao|oes)|conflito[s]?|falha[s]?|erro[s]?|sobrecarga|sobrecarregad[oa]s?|excesso\s+de|queda|baixo\s+(?:desempenho|rendimento|aproveitamento|numero)|baixa\s+(?:procura|adesao|frequencia|participacao)|dificultand\w+|prejudic\w+|impacto\s+negativo|riscos?|dificuldades|precari\w+|defasad[oa]s?|obsolet[oa]s?|perda\s+d[aeo]s?|sem\s+(?:acesso|estrutura|condicoes|recursos|professor\w*))\b/;
const RE_REPORT = /\b(?:foi|foram)\s+(?:relatad|apontad|identificad|observad|constatad|verificad|registrad|levantad|mencionad|pontuad|destacad|ressaltad|sinalizad|percebid|detectad|informad|comunicad|expost|manifestad)[oa]s?\b|\b(?:relatou|relataram|apontou|apontaram|destacou|ressaltou|pontuou|observou|constatou|verificou|salientou|alertou|denunciou|mencionou|mencionaram|expos|sinalizou|sinalizaram|verificou-se|constatou-se|observou-se|identificou-se|percebeu-se|notou-se|registrou-se|houve|ha\s+(?:relatos?|reclamac\w+|queixas?)|os\s+participantes\s+(?:demonstraram|manifestaram|relataram|apontaram)|demonstrou\s+preocupacao|manifestou\s+preocupacao|demonstraram\s+preocupacao|manifestaram\s+preocupacao|(?:levantou|levantaram|expressou|expressaram|externou|externaram|apontou|apontaram)\s+(?:a\s+|uma\s+|sua\s+)?(?:preocupac\w+|problema|dificuldade|questao\s+d[aeo]))\b/;
const RE_STATE = /\b(?:ha|existe|existem|persiste|persistem|ocorre|ocorrem|esta|estao|continua|continuam|vem\s+\w+ndo|segue|seguem|tem|tem|apresenta|apresentam|enfrenta|enfrentam)\b/;
const RE_PROB_RESOLVED = /\b(?:resolveu|solucionou|resolvid[oa]s?|superad[oa]s?|sanad[oa]s?|equacionad[oa]s?|solucionad[oa]s?|corrigid[oa]s?|regularizad[oa]s?|controlad[oa]s?|mitigad[oa]s?)\b/;
// palavra-problema NEGADA ("não prejudica", "sem atrasos", "nenhuma falha") ou só como TEMA
// ("palestra sobre evasão", "prevenção da evasão") não descreve um obstáculo
const RE_CUE_NEG_BEFORE = /\b(?:nao|nem|nenhum|nenhuma|sem|jamais|nunca|inexistencia\s+de)\b(?:\s+\S+){0,3}\s*$/;
const RE_CUE_TOPIC_BEFORE = /\b(?:sobre|acerca\s+d[aeo]s?|tema|temas|palestra|seminario|debate\s+sobre|discussao\s+sobre|estudo|pesquisa|combate|prevencao|reducao|enfrentamento|monitoramento|indicadores?\s+de|taxa\s+de|dados\s+de)\s+(?:\S+\s+){0,2}$/;
// idiomas com "não há como" que não são impedimento: "não há como negar", "não há como deixar de…"
const RE_NO_POSSIB_IDIOM = /\bnao\s+ha\s+como\s+(?:negar|deixar|nao|esquecer|ignorar)\b/;
const RE_NO_PROB = /\bnao\s+(?:ha|houve|existe|existem|foram|foi|tem)\s+(?:\S+\s+){0,2}?(?:problemas?|dificuldades?|reclamac\w+|pendencias?|queixas?)|\bsem\s+(?:problemas?|dificuldades?|pendencias?)|\bnenhum[a]?\s+(?:problema|dificuldade|pendencia|reclamacao)/;

// Impedimento / indisponibilidade: contém "possibilidade", mas é o oposto de uma sugestão.
const RE_NO_POSSIB = /\b(?:nao\s+(?:ha|existe|existem|houve|havera|tem|tinha|tera)\s+(?:mais\s+)?(?:\S+\s+){0,2}?possibilidades?|sem\s+possibilidades?|nao\s+(?:foi|sera|seria|e|era|esta|estava)\s+possivel|nao\s+ha\s+como|impossibilidade\s+de|inviabilidade|nao\s+(?:e|foi|sera)\s+viavel|nao\s+(?:ha|existem?)\s+condicoes)\b/;
const RE_REQUEST = /\b(?:solicitou|solicitaram|solicita|solicitam|(?:esta|estao|vem|vinha)\s+sendo\s+(?:solicitad|pedid|requerid)[oa]s?|solicita-se|solicitou-se|foi\s+solicitad[oa]s?|foram\s+solicitad[oa]s?|pediu|pediram|pede-se|foi\s+pedid[oa]|requereu|requereram|requer-se|reivindicou|reivindicaram|demandou|demandaram|manifestou\s+(?:interesse|desejo)|manifestaram\s+(?:interesse|desejo)|registrou-se\s+(?:a|uma)\s+demanda|foi\s+registrad[oa]\s+(?:a\s+|uma\s+)?demanda|os\s+participantes\s+solicitaram)\b/;
const RE_NEED = /\b(?:(?:ha|existe|surgiu|identificou-se|foi\s+identificad[oa]|foi\s+apontad[oa]|foi\s+levantad[oa]|verificou-se|constatou-se|observou-se)\s+(?:a\s+)?(?:necessidade|urgencia|carencia|demanda)\b|e\s+(?:necessario|preciso|imprescindivel|fundamental|urgente)\b|sera\s+necessari[oa]s?\b|faz(?:em)?\s+falta\b|precisa(?:m)?\s+(?:de|ser)\b|necessita(?:m)?\b|necessidade\s+de\b)/;
const RE_REQUEST_PROCEDURAL = /\b(?:solicit\w*|ped\w*)\s+(?:a\s+)?(?:palavra|esclarecimentos?|vista|licenca|inclusao\s+(?:de|na)\s+pauta|desculpas)\b|\bpedidos?\s+de\s+(?:vista|palavra|licenca|esclarecimentos?)\b/;
// Formas NOMINAIS de demanda: "solicitação de…", "pedido de…", "requerimento de…", "demanda por…"
const RE_REQUEST_NOUN = /\b(?:solicitac(?:ao|oes)|pedidos?|requerimentos?|reivindicac(?:ao|oes)|pleitos?|demandas?)\s+(?:de|por|para|d[aeo]s?|referente|relativ[oa]s?)\b/;
const RE_REQ_TITLE = /^(?:solicitac(?:ao|oes)|pedidos?|requerimentos?|demandas?|reivindicac(?:ao|oes)|pleitos?)\b/;

const RE_INTENT = /\b(?:gostaria|gostariam|pretende|pretendem|pretendia|planeja|planejam|tem\s+a\s+intencao|ha\s+a\s+intencao|espera-se|esperam-se|deseja|desejam|almeja)\b/;
const RE_RULE = /\b(?:sera|serao|podera|poderao|devera|deverao|ficara|ficarao|seguira|seguirao|fica|ficam|passa|passam|passara|passarao|poderia|poderiam)\b/;
const RE_FUT_HINT = /\b(?:sera|serao|devera|deverao|ira|irao|vai|vao|ate|antes|apos|a\s+partir|proxim\w+|prazo|durante|passa\s+a|passara|entrara|vigora|vigorar|valera|implant\w+|implement\w+)\b/;

function snippetOf(origTokens, m, start, len) {
  const w0 = (m.slice(0, start).match(/\S+/g) || []).length;
  const wc = (m.slice(start, start + len).match(/\S+/g) || []).length || 1;
  return origTokens.slice(w0, w0 + wc).join(' ').replace(/[,;]+$/, '');
}

// "aprovado em/na <disciplina>", "aprovado com nota/média", "por frequência" — desempenho, não deliberação.
// Exclui órgãos deliberativos: "aprovado na reunião / no colegiado / no conselho" É deliberação.
const RE_ACADEMIC_RESULT = /^\s+(?:(?:em|na|no|nas|nos)\s+(?!(?:\S+\s+)?(?:reuniao|reunioes|sessao|colegiado|conselho|plenari\w*|assembleia|nde|camara|comissao|departamento|congregacao|forma|termos|integra|ata|votacao|unanimidade|instancia|ambito|mesma)\b)|com\s+(?:nota|media|conceito|frequencia)\b|por\s+(?:media|nota|frequencia)\b)/;
function scoreDecision(orig, n, m, toks, sctx) {
  if (/^\s*(?:ata|reuniao)\b/.test(n) && n.length < 40) return null;
  let best = null;
  const consider = (score, gat, kind, at, part) => { if (!best || score > best.score) best = { score, gatilho: gat, kind, at: at || 0, part: part || null }; };
  const refSpans = [];
  [RE_REF_A, RE_REF_B].forEach(re => { re.lastIndex = 0; let r; while ((r = re.exec(m))) { refSpans.push([r.index, r.index + r[0].length]); if (!r[0].length) re.lastIndex++; } });
  const inRef = idx => refSpans.some(([a, b]) => idx >= a && idx < b);

  // (1) foi/ficou + particípio
  RE_FRAME.lastIndex = 0;
  let fm;
  while ((fm = RE_FRAME.exec(m))) {
    const between = fm[1] || '';
    if (/\b(?:que|se|quando|caso|porque|pois|como|onde)\b/.test(between)) continue;
    const partIdx = fm.index + fm[0].length - fm[2].length;
    if (inRef(fm.index) || inRef(partIdx)) continue;
    let sc = DEC_STRONG_PART.test(fm[2]) ? 0.8 : 0.72;
    // resultado acadêmico de aluno ("alunos foram aprovados", "foi aprovado na disciplina") não é deliberação
    if (/^(?:aprovad|reprovad)/.test(fm[2])) {
      const before = m.slice(0, fm.index);
      if (RE_STUDENT.test(before) && !RE_NOT_STUDENT_OBJ.test(m)) sc -= 0.5;
      else if (RE_ACADEMIC_RESULT.test(m.slice(fm.index + fm[0].length))) sc -= 0.5;
    }
    consider(sc, snippetOf(toks, m, fm.index, fm[0].length), 'frame', fm.index, fm[2]);
  }
  if (!best) {
    const sp = m.match(RE_START_PART);
    if (sp && !/^(?:aprovad|reprovad)[oa]s?\s+(?:em|na|no|nas|nos)\b/.test(m)) consider(0.7, snippetOf(toks, m, sp.index, sp[0].length), 'start', sp.index);
  }
  // (2) verbo + "-se"
  let x = m.match(RE_SE);
  if (x && !inRef(x.index)) consider(0.76, snippetOf(toks, m, x.index, x[0].length), 'se', x.index);
  // (3) sujeito + verbo deliberativo
  x = m.match(RE_AGENT);
  if (x && !inRef(x.index)) {
    const ctxAfter = m.slice(x.index, x.index + 40);
    if (!/^(?:aprovou|aprovaram|reprovou|reprovaram)\s+(?:o|a|os|as)\s+(?:alun|estud|candidat|discent)/.test(ctxAfter)) consider(0.72, snippetOf(toks, m, x.index, x[0].length), 'agente', x.index);
  }
  x = m.match(RE_CONCORD);
  if (x && RE_COLLECTIVE.test(m)) consider(0.7, snippetOf(toks, m, x.index, x[0].length), 'consenso', x.index);
  x = m.match(RE_CONSENSO);
  if (x && !/\bnao\s+(?:\S+\s+){0,1}?(?:chegou-se|houve)\b/.test(m)) consider(0.68, snippetOf(toks, m, x.index, x[0].length), 'consenso', x.index);
  // (4) só o resultado da votação, sem verbo ("Por unanimidade.")
  if (!best && RE_VOTE_START.test(m) && wordsOf(orig).length <= 8) consider(0.6, orig.replace(/[.!]+$/, ''), 'voto');
  // (5) bloco "Decisão:" / "Deliberação:" — o rótulo vale como evidência
  if (!best && sctx.labelType === 'decisao' && wordsOf(orig).length >= 3) consider(0.68, 'rótulo "Decisão"', 'rotulo');

  if (!best) return null;
  let score = best.score;
  if (RE_VOTE.test(m)) score += 0.12;
  // decisão citada DENTRO de um relato ("informou que o pedido foi indeferido pela pró-reitoria")
  // é contexto — normalmente decisão de outra instância. Só vale com resultado de votação explícito.
  const rcs = reportComplementStart(m);
  if (rcs >= 0 && best.kind !== 'rotulo' && !RE_VOTE.test(m) && best.at >= rcs) score -= 0.3;
  const hedged = RE_HEDGE.exec(m);
  if (hedged && best.kind !== 'rotulo') score -= 0.35;
  if (RE_COND.test(m)) score -= /decid|defin|acord|delib|ficou/.test(m) ? 0.1 : 0.2;
  if (/\bnao\s+(?:foi|foram)\s+(?:\S+\s+){0,2}?(?:ainda\s+)?(?:decidid|definid|deliberad)/.test(m)) score -= 0.5;
  // proposta/sugestão que aparece ANTES do verbo de decisão, sem resultado: continua sendo proposta
  if (best.kind === 'frame' && RE_PROP_VERB.test(m) && !/\bpropost[oa]s?\s+(?:foi|foram)\b/.test(m) && !RE_VOTE.test(m) && !DEC_STRONG_PART.test(m)) {
    const pv = m.search(RE_PROP_VERB), fi = m.search(RE_FRAME);
    if (pv >= 0 && fi >= 0 && pv < fi && /\bque\b/.test(m.slice(pv, fi))) score -= 0.45;   // "sugeriu que fosse/foi aprovada"
  }
  score = Math.max(0, Math.min(0.97, score));
  if (score < 0.5) return null;
  // resposta curta que só faz sentido junto da frase anterior ("Aprovado por unanimidade.")
  const noVote = orig.replace(/\b(?:por\s+(?:unanimidade|maioria)(?:\s+(?:simples|absoluta|dos\s+votos|dos\s+presentes))?|com\s+\w+\s+votos?\s+\w+)/gi, '');
  const anaphoric = wordsOf(noVote).length <= 4 && (best.kind === 'start' || best.kind === 'voto' ||
    (best.kind === 'frame' && /^(?:a\s+(?:proposta|solicitacao|ata|mocao|materia|sugestao)\s+)?(?:foi|foram|ficou|ficaram)\s+(?:\S+\s+){0,2}?(?:aprovad|rejeitad|deferid|indeferid|aceit|acatad|negad|reprovad)/.test(m)));
  return { score, gatilho: best.gatilho, anaphoric, kind: best.kind, at: best.at, part: best.part };
}

const RE_DISCUSSED_POSSIB = /\b(?:discutiu|discutiram|discutiu-se|debateu|debateram|debateu-se|abordou|abordaram|abordou-se|tratou-se|conversou|conversaram|(?:foi|foram)\s+(?:discutid|debatid|abordad|tratad|levantad|mencionad)[oa]s?)\s+(?:\S+\s+){0,3}?(?:a\s+)?possibilidades?\b/;
function scoreProposal(orig, n, m, toks) {
  if (RE_NO_POSSIB.test(m)) return null;      // regra negativa: "não há possibilidade de…" não é sugestão
  let best = null;
  const consider = (score, gat, tipo, via) => { if (!best || score > best.score) best = { score, gatilho: gat, tipo, via }; };
  let x = m.match(RE_PROP_VERB);
  if (x) consider(0.72, snippetOf(toks, m, x.index, x[0].length), /\bpropost|proposta|propos/.test(x[0]) || RE_PROPOSAL_FORMAL.test(m) ? 'proposta' : 'sugestao', 'verbo');
  x = m.match(RE_PROP_MODAL);
  // modal dentro de relato não é proposta; "discutiu-se a possibilidade de…" é tema de discussão, não sugestão
  if (x && !RE_DISCUSSED_POSSIB.test(m)) { const rcs = reportComplementStart(m); if (!(rcs >= 0 && x.index >= rcs)) consider(0.58, snippetOf(toks, m, x.index, x[0].length), 'sugestao', 'modal'); }
  if (!best && RE_PROPOSAL_FORMAL.test(m) && /\b(?:apresentad|encaminhad|elaborad|enviad|entregu)\w*/.test(m) && !/\b(?:aprovad|rejeitad|aceit|deferid|indeferid)/.test(m)) {
    x = m.match(RE_PROPOSAL_FORMAL); consider(0.55, snippetOf(toks, m, x.index, x[0].length), 'proposta', 'formal');
  }
  return best;
}

function scoreProblem(orig, n, m, toks) {
  if (RE_NO_PROB.test(m)) return null;
  const npos = RE_NO_POSSIB_IDIOM.test(m) ? null : m.match(RE_NO_POSSIB);
  if (npos) {
    const rcs = reportComplementStart(m);
    return { score: rcs >= 0 && npos.index >= rcs ? 0.62 : 0.74, gatilho: snippetOf(toks, m, npos.index, npos[0].length), subtipo: 'impedimento', via: 'impedimento', relatado: rcs >= 0 && npos.index >= rcs };
  }
  const cues = [];
  let re = new RegExp(RE_PROB_CUE.source, 'g'), x;
  while ((x = re.exec(m))) {
    if (!x[0].length) { re.lastIndex++; continue; }
    const before = m.slice(Math.max(0, x.index - 40), x.index);
    if (!/^sem\s/.test(x[0]) && RE_CUE_NEG_BEFORE.test(before)) continue;     // negado
    if (RE_CUE_TOPIC_BEFORE.test(before)) continue;                          // só tema
    cues.push(x);
  }
  if (!cues.length) return null;
  let score = 0.4 + (new Set(cues.map(c => c[0])).size > 1 ? 0.1 : 0);
  let rep = m.match(RE_REPORT);
  if (rep) score += 0.3;
  if (RE_STATE.test(m)) score += 0.2;
  if (RE_PROB_RESOLVED.test(m)) score -= 0.4;
  if (/^\W*(?:ata|reuniao)\b/.test(n)) score -= 0.2;
  score = Math.min(0.85, score);
  if (score < 0.6) return null;
  return { score, gatilho: snippetOf(toks, m, (rep || cues[0]).index, (rep || cues[0])[0].length), via: rep ? 'relato' : 'estado',
    pistas: new Set(cues.map(c => c[0])).size, estado: RE_STATE.test(m) };
}

/* ---------- RELATO × AÇÃO ----------
   "O professor relatou QUE recebeu um pedido…" — tudo depois de "relatou que" é CONTEÚDO RELATADO
   (contexto). Uma palavra-chave dentro do relato ("pedido", "precisa", "solicitou") não transforma
   a sentença em demanda/decisão/encaminhamento; o ATO precisa estar na oração principal, ou o relato
   precisa trazer evidência própria forte (votação, atribuição explícita...). */
const REPORT_STEMS = 'relat|inform|explic|esclarec|coment|lembr|relembr|destac|mencion|ressalt|salient|pontu|observ|afirm|declar|justific|argument|acrescent|fris|comunic|report|alert|avis|contextualiz|recorda|apresent|registr|ponder|aleg|enfatiz|notici|cont|expl?an|reforc|recapitul';
const RE_REPORT_FRAME = new RegExp('\\b(?:(?:' + REPORT_STEMS + ')(?:ou|aram|ram|eu|eram|iu|iram)|disse|disseram|expos|expuseram|fez\\s+saber|deu\\s+ciencia)' +
  '(?:\\s+(?:ainda|tambem|entao|brevemente|aos?\\s+(?:presentes|membros|colegiado|demais)|as?\\s+(?:presentes|membros|plenaria)))*\\s+que\\b');
function reportComplementStart(m) {
  const x = RE_REPORT_FRAME.exec(m);
  return x ? x.index + x[0].length : -1;
}
// "recebeu um pedido", "chegou uma solicitação", "tomou conhecimento da demanda": o substantivo é
// OBJETO de um relato, não um ato de pedir praticado na reunião.
const RE_RECEIPT = /\b(?:recebeu|receberam|recebemos|recebid[oa]s?|chegou|chegaram|tomou\s+conhecimento|tomaram\s+conhecimento|encaminhou|repassou|trouxe|trouxeram|apresentou|apresentaram|analisou|analisaram|relatou|leu|leram)\s+(?:\S+\s+){0,3}?(?:pedidos?|solicitac\w+|requerimentos?|demandas?|reclamac\w+|reivindicac\w+|pleitos?)\b/;
// Verbo finito (tempo verbal conjugado) — usado para saber se a frase é só um sintagma nominal.
const RE_FINITE = /\b(?:foi|foram|e|sao|era|eram|esta|estao|estava|estavam|ha|houve|havia|sera|serao|tem|teve|tinham|fica|ficou|ficaram|pode|podem|deve|devem|\w{3,}(?:ou|aram|eram|iram|ara|arao|era|erao|ira|irao))\b/;
function isNominalRequest(m) {
  return /^(?:(?:a|o|as|os|uma?)\s+)?(?:solicitac|pedido|requerimento|reivindicac|pleito|demanda)/.test(m) && !RE_FINITE.test(m);
}

function scoreDemand(orig, n, m, toks) {
  if (RE_REQUEST_PROCEDURAL.test(m)) return null;
  const rep = reportComplementStart(m);
  const embedded = idx => rep >= 0 && idx >= rep;
  let best = null;
  const consider = (score, x, kind) => { if (!best || score > best.score) best = { score, gatilho: snippetOf(toks, m, x.index, x[0].length), kind }; };
  // (a) ato explícito de pedir ("solicitou", "requereu", "foi solicitado") — na oração principal
  let x = m.match(RE_REQUEST);
  if (x) consider(embedded(x.index) ? 0.45 : 0.72, x, 'pedido');
  // (b) necessidade declarada ("é necessário", "há necessidade de") — fraca dentro de relato
  x = m.match(RE_NEED);
  if (x) consider(embedded(x.index) ? 0.4 : 0.64, x, 'necessidade');
  // (c) forma nominal ("Solicitação de…") só quando a frase INTEIRA é o pedido (registro/título),
  //     nunca quando o substantivo é objeto de um relato ("recebeu um pedido de…")
  x = m.match(RE_REQUEST_NOUN);
  if (x && isNominalRequest(m) && !RE_RECEIPT.test(m)) consider(0.64, x, 'nominal');
  return best && best.score >= 0.6 ? best : null;
}

/* ---------- ENCAMINHAMENTOS: AÇÃO + RESPONSÁVEL + PRAZO ---------- */
const FUT_GENERIC = /(^|[^a-zà-ú])((?:[a-zà-ú]{3,}(?:ará|erá|irá|arão|erão|irão))|fará|farão|dará|darão|trará|trarão)(?![a-zà-ú])/g;
const PART_ACTION = String.raw`(\w{3,}(?:ad|id)[oa]s?|feit[oa]s?|abert[oa]s?|propost[oa]s?|post[oa]s?|escrit[oa]s?|dit[oa]s?)`;

function findEncCue(orig, n, m, lc, sctx) {
  const cues = [];
  const add = (score, tipo, start, end, extra) => cues.push(Object.assign({ score, tipo, start, end }, extra || {}));
  let x;
  // atribuição explícita
  if ((x = n.match(/\b(?:ficara|ficarao|ficou|ficaram|fica|ficam|sera|serao)\s+(?:(?:o|a|os|as)\s+)?(?:\S+\s+)?(?:responsavel|responsaveis|incumbid[oa]s?|encarregad[oa]s?)\b/)))
    add(0.85, 'atribuicao', x.index, x.index + x[0].length, { acaoAfter: /\s+(?:por|de|para|pel[ao]s?)\s+/ });
  if ((x = n.match(/\b(?:foi|foram|ficou|ficaram)\s+(?:\S+\s+)?(?:incumbid|encarregad|designad)[oa]s?\s+(?:de|para|a)\s+/)))
    add(0.82, 'atribuicao', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  if ((x = n.match(/\b(?:se\s+comprometeu|se\s+comprometeram|comprometeu-se|comprometeram-se|responsabilizou-se|responsabilizaram-se|se\s+responsabilizou|se\s+responsabilizaram|ofereceu-se|ofereceram-se|disponibilizou-se|disponibilizaram-se|prontificou-se|prontificaram-se|dispos-se|se\s+dispos\w*)\b/)))
    add(0.82, 'compromisso', x.index, x.index + x[0].length, { acaoAfter: /\s+(?:a|de|por|em)\s+/ });
  if ((x = n.match(/\b(?:assumiu|assumiram|assumira|assumirao)\s+(?:o\s+compromisso|a\s+tarefa|a\s+responsabilidade|a\s+missao|a\s+incumbencia)\s+(?:de|por|em)\s+/)))
    add(0.82, 'compromisso', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  if ((x = n.match(/\b(?:ficou|ficaram|ficara|ficarao)\s+de\s+(?=\w+(?:ar|er|ir|or)\b)/)))
    add(0.8, 'compromisso', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  if ((x = n.match(/\b(?:cabe|cabera|caberao|compete|competira|competirao|incumbe|incumbira)\s+(?:a|ao|aos|as)\s+/)))
    add(0.78, 'atribuicao', x.index, x.index + x[0].length, { acaoAfter: /^/, inf: true });
  if ((x = n.match(/\bencaminh(?:ou|aram|a|am|e|em)-se\b|\bencaminhar-se-a\b|\b(?:foi|foram|ficou|ficaram)\s+(?:\S+\s+){0,1}?encaminhad[oa]s?\b|\bfica(?:m)?\s+encaminhad[oa]s?\b|\bsera(?:o)?\s+encaminhad[oa]s?\b/)))
    add(0.8, 'encaminhado', x.index, x.index + x[0].length, { acaoAfter: null });
  if ((x = n.match(/\bencaminhamentos?\s*[:\-–]/))) add(0.8, 'rotulo', x.index, x.index + x[0].length, { acaoAfter: /^/ });
  // obrigação / futuro com infinitivo
  const deon = /\b(devera|deverao|precisara|precisarao|tera\s+que|terao\s+que|tera\s+de|terao\s+de|necessitara|necessitarao)\s+((?:\S+\s+){0,2}?)(\w+(?:ar|er|ir|or))\b/g;
  while ((x = deon.exec(n))) {
    const inf = x[3];
    const infStart = x.index + x[0].length - inf.length;
    if (NON_ACTION_INF.has(inf) && inf !== 'ser') continue;
    if (inf === 'ser') { const pp = n.slice(infStart + 3).match(new RegExp('^\\s+(?:\\S+\\s+){0,1}?' + PART_ACTION)); if (!pp || NON_ACTION_PART.test(pp[1]) || !isOperational(pp[1])) continue; }
    add(0.68, 'obrigacao', x.index, x.index + x[0].length, { infStart });
    break;
  }
  const deve = /\b(deve|devem)\s+((?:\S+\s+){0,1}?)(\w+(?:ar|er|ir|or))\b/g;
  while ((x = deve.exec(n))) {
    const inf = x[3]; if (NON_ACTION_INF.has(inf) && inf !== 'ser') continue;
    add(0.45, 'obrigacao_presente', x.index, x.index + x[0].length, { infStart: x.index + x[0].length - inf.length });
    break;
  }
  const ir = /\b(ira|irao|vai|vao)\s+((?:\S+\s+){0,2}?)(\w{3,}(?:ar|er|ir|or))\b/g;
  while ((x = ir.exec(n))) {
    const inf = x[3]; const infStart = x.index + x[0].length - inf.length;
    if (NON_ACTION_INF.has(inf) && inf !== 'ser') continue;
    if (inf === 'ser') { const pp = n.slice(infStart + 3).match(new RegExp('^\\s+(?:\\S+\\s+){0,1}?' + PART_ACTION)); if (!pp || NON_ACTION_PART.test(pp[1]) || !isOperational(pp[1])) continue; }
    add(0.65, 'futuro_ir', x.index, x.index + x[0].length, { infStart });
    break;
  }
  // voz passiva futura: "será realizada uma consulta"
  const pas = new RegExp('\\b(?:sera|serao)\\s+(?:\\S+\\s+){0,1}?' + PART_ACTION, 'g');
  while ((x = pas.exec(n))) {
    const part = x[1];
    if (NON_ACTION_PART.test(part) || !isOperational(part)) continue;
    add(0.66, 'passiva_futura', x.index, x.index + x[0].length, { infStart: x.index });
    break;
  }
  // futuro do presente, 3ª pessoa (sujeito + verbo): "enviará", "elaborarão"
  FUT_GENERIC.lastIndex = 0;
  while ((x = FUT_GENERIC.exec(lc))) {
    const verb = x[2]; const f = fold(verb);
    const start = x.index + x[1].length;
    if (NON_ACTION_FUT.has(f)) continue;
    if (AMBIG_FUT.has(f)) {
      if (/^entrar[aã]o?$/.test(f) || /^entrar[a]?o?$/.test(f)) { if (!/^entr(?:ara|arao)\s+em\s+contato/.test(n.slice(start))) continue; }
      else if (/^passara$/.test(f)) { if (/^passara\s+a\b/.test(n.slice(start))) continue; }
      else { add(0.5, 'futuro_ambiguo', start, start + verb.length, { infStart: start }); break; }
    }
    // futuro de verbo NÃO operacional ("seguirá", "ofertará") nunca atinge o limiar sozinho
    add((isOperational(f) || /^entrar[a]?o?$/.test(f)) ? 0.55 : 0.3, 'futuro_ativo', start, start + verb.length, { infStart: start });
    break;
  }
  if ((x = n.match(/\b(?:vamos|iremos)\s+(?:\S+\s+){0,1}?\w{3,}(?:ar|er|ir|or)\b|\b\w{3,}(?:aremos|eremos|iremos)\b/)))
    add(0.62, 'futuro_nos', x.index, x.index + x[0].length, { infStart: x.index });
  // infinitivo no início de item de lista / sob rótulo "Encaminhamentos:"
  if ((sctx.listItem || sctx.labelType === 'encaminhamento') && ACT_INF_START.test(orig.replace(/^\W+/, '')))
    add(0.64, 'infinitivo', 0, 0, { infStart: orig.search(/[A-Za-zÀ-ú]/) });
  if (!cues.length) return null;
  cues.sort((a, b) => b.score - a.score || a.start - b.start);
  return cues[0];
}

function scoreEncaminhamento(orig, n, m, lc, toks, sctx, decisionHit) {
  const cue = findEncCue(orig, n, m, lc, sctx);
  const labeled = sctx.labelType === 'encaminhamento' && wordsOf(orig).length >= 3;
  let score = 0, tipo = null, c = cue;
  if (c) { score = c.score; tipo = c.tipo; }
  else if (labeled) { score = 0.62; tipo = 'rotulo'; c = { start: -1, tipo }; }
  else return null;
  if (labeled && c.tipo !== 'rotulo') score += 0.2;
  if (decisionHit && decisionHit.kind !== 'rotulo') score += 0.1;
  const propBlock = RE_PROP_VERB.test(m) || RE_PROP_MODAL.test(m);
  const firm = ['atribuicao', 'compromisso', 'encaminhado'].includes(c.tipo);
  if (propBlock && !firm && !decisionHit) score -= 0.6;
  if (RE_REQUEST.test(m) && !firm && !decisionHit) score -= 0.4;
  if (RE_INTENT.test(m) && !firm) score -= 0.4;
  if (RE_COND.test(m)) score -= 0.15;
  // ação dentro de relato: "relatou que o aluno irá cursar…" é contexto. Se o verbo vem logo após
  // "que" (sem sujeito próprio: "informou que enviará…"), o sujeito é o próprio relator — compromisso.
  const rcs = reportComplementStart(n);                     // índices de cue estão em n
  const cueAt = c.start >= 0 ? c.start : (c.infStart != null ? c.infStart : -1);
  if (rcs >= 0 && cueAt >= rcs && !firm && c.tipo !== 'rotulo') {
    const between = n.slice(rcs, cueAt).replace(/[,;]/g, ' ').trim();
    if (between && !/^(?:se|ira|irao|vai|vao)$/.test(between)) score -= 0.2;
  }
  if (/\bnao\s+(?:sera|serao|\w+(?:ara|era|ira)\b)/.test(m)) score -= 0.3;
  if (/\bnecessario|\bpreciso\b/.test(m) && !firm && c.tipo === 'passiva_futura') score -= 0.2;
  return { score, cue: c, gatilho: c.start >= 0 && c.end > c.start ? orig.slice(c.start, c.end).trim() : (labeled ? 'rótulo "Encaminhamentos"' : null) };
}

/* ---------- apoio: ação, prazo e responsável ---------- */
function buildAcao(orig, n, cue, T) {
  if (!cue || cue.start < 0) return trimEnd(orig);
  let from = cue.infStart != null ? cue.infStart : cue.end;
  if (cue.acaoAfter) {
    const rest = n.slice(cue.end);
    const mm = rest.match(cue.acaoAfter);
    if (mm) from = cue.end + mm.index + mm[0].length;
  }
  // voz passiva: o objeto da ação é o SUJEITO gramatical ("O tema será retomado") — inclui-o se for curto
  if (cue.tipo === 'encaminhado' || cue.tipo === 'passiva_futura') {
    from = cue.start;
    const pre = orig.slice(0, cue.start);
    if (pre.trim() && wordsOf(pre).length <= 8 && !/[,;:]/.test(pre)) from = 0;
  }
  if (cue.inf) {
    const after = n.slice(cue.end);
    const ent = forwardPhrase(orig.slice(cue.end));
    const skip = ent ? ent.length : 0;
    const mi = n.slice(cue.end + skip).match(/(?:^|\s)(\w{3,}(?:ar|er|ir|or))\b/);
    if (mi) from = cue.end + skip + mi.index + (mi[0].length - mi[1].length);
  }
  let to = orig.length;
  if (T && T.principal && T.principal.start > from) to = T.principal.start;
  let out = orig.slice(from, to);
  out = out.replace(/[\s,;:(–-]+$/, '').replace(/\s+(?:at[ée]|em|para|no|na|de|a|ao)$/i, '');
  out = trimEnd(squash(out));
  return out.length >= 4 ? clip(out, 220) : trimEnd(orig);
}

/* ---------- PRAZO × CONTEXTO ----------
   Uma data/período só é PRAZO quando está RELACIONADO a uma ação, decisão ou obrigação:
     • marcador relacional forte: "até", "antes de", "no prazo de", "prazo", "data limite", "dentro de";
     • reunião futura ("na próxima reunião", "reunião seguinte");
     • oração no futuro/obrigação ("deverá ocorrer em", "será realizado em", "enviará … para 2026/2");
     • em decisões, vigência explícita ("a partir de", "durante", "para o semestre…").
   Caso contrário é CONTEXTO ("cursada em 2024.1", "currículo 2023.2", "no último semestre").
   Período anterior à reunião é sempre contexto.                                           */
const RE_DEADLINE_LEAD = /^(?:prazo|data\s+limite|ate|antes|no\s+prazo|dentro\s+de|no\s+maximo|impreterivelmente|logo\s+(?:apos|antes))/;
const RE_FUT_CLAUSE = /(?:^|[^a-zà-ú])(?:será|serão|deverá|deverão|irá|irão|vai|vão|ficará|ficarão|precisará|precisarão|terá|terão|haverá|[a-zà-ú]{3,}(?:ará|erá|irá|arão|erão|irão)|devem?\s+[a-zà-ú]+(?:ar|er|ir))(?![a-zà-ú])/;
function temporalRole(ref, kind, lc) {
  if (kind === 'rotulo') return 'prazo';                // veio de "Prazo:" ou coluna de prazo
  if (ref.passado) return 'contexto';
  const t = fold(ref.texto);
  if (RE_DEADLINE_LEAD.test(t)) return 'prazo';
  if (ref.tipo === 'reuniao') return 'prazo';
  // data absoluta futura (já filtrada: datas anteriores à reunião não chegam aqui) é concreta e
  // ligada ao que a frase registra — "com início em 03/08/2026", "a prova será em 29/11"
  if (ref.tipo === 'data' && ref.iso) return 'prazo';
  if (/^(?:com\s+inicio|a\s+contar|com\s+vigencia|com\s+efeito)/.test(t)) return 'prazo';
  if (ref.tipo === 'indefinido') return kind === 'encaminhamento' ? 'prazo' : 'contexto';
  if (RE_FUT_CLAUSE.test(lc || '')) return 'prazo';
  if (kind === 'decisao' && /^(?:a\s+partir|durante|para|ao\s+longo|no\s+decorrer|desde)/.test(t)) return 'prazo';
  return 'contexto';
}
// Devolve uma visão de T em que principal = primeira referência com papel "prazo".
function withRoles(T, kind, lc) {
  if (!T) return null;
  const refs = T.refs.map(r => Object.assign({}, r, { papel: r.anexa ? 'anexa' : temporalRole(r, kind, lc) }));
  const cand = refs.filter(r => r.papel === 'prazo');
  const principal = cand.find(r => r.tipo !== 'indefinido') || cand[0] || null;
  return { principal, refs };
}

function applyPrazo(item, T, orig, useIt) {
  if (!useIt || !T) return;
  const ctxRefs = T.refs.filter(r => r.papel === 'contexto');
  if (!T.principal) {
    if (ctxRefs.length) item.referencias = ctxRefs.slice(0, 4).map(r => ({ texto: r.texto, tipo: r.tipo, papel: 'contexto' }));
    return;
  }
  const p = T.principal;
  item.prazo = p.texto;
  item.prazoTipo = p.tipo;
  const core = (T.refs.find(r => r.start === p.start) || {}).core;
  item.prazoData = p.dataAssociada || (p.tipo === 'data' ? (core || null) : null);
  item.prazoISO = p.iso || null;
  const others = T.refs.filter(r => !r.anexa && r.start !== p.start).map(r => ({ texto: r.texto, tipo: r.tipo, dataAssociada: r.dataAssociada, papel: r.papel || 'prazo' }));
  if (others.length) item.referencias = others.slice(0, 4);
}

function applyActors(item, ents) {
  if (!ents || !ents.length) return;
  item.responsaveis = ents.map(e => Object.assign({ nome: e.nome, cargo: e.cargo || null, tipo: e.tipo || 'orgao' }, e.alt ? { alternativa: true } : {}));
  // texto preserva a conjunção original: "Coordenação ou Direção" ≠ "Coordenação e Direção"
  item.responsavel = ents.map((e, i) => (i ? (e.sepBefore === 'ou' ? ' ou ' : (e.sepBefore === ',' ? ', ' : ' e ')) : '') + e.nome).join('');
  item.responsavelTipo = ents.some(e => e.alt) ? 'alternativo' : (ents.length > 1 ? 'conjunto' : 'unico');
  const withCargo = ents.find(e => e.cargo);
  if (withCargo && ents.length === 1) item.cargo = withCargo.cargo;
}

const level = s => s >= 0.8 ? 'alta' : (s >= 0.65 ? 'média' : 'baixa');

/* ============================================================
   CONFIANÇA DA CLASSIFICAÇÃO
   O que ela significa: o quanto o SISTEMA considera segura a classificação automática
   de um trecho (decisão, encaminhamento…). Não mede importância, prioridade, nem a
   veracidade ou confiabilidade da ata.

   Duas etapas separadas:
     1. os classificadores decidem SE o trecho entra (limiares próprios);
     2. calibrateConfidence() decide QUÃO SEGURA é a classificação, a partir de sinais:
        • força do gatilho textual (construção deliberativa explícita × palavra solta);
        • estrutura (o trecho está no bloco de um item da pauta/cabeçalho; rótulo "Decisão:"…);
        • contexto da frase (relato, hipótese, condição, dependência da frase anterior);
        • relação com o assunto do bloco;
        • consistência entre evidências independentes.
   Cada ajuste vira uma EVIDÊNCIA legível em item.evidencias, para a interface explicar a nota.
   Abaixo de 0.5 a evidência é insuficiente e o item não é registrado.
============================================================ */
const CONF_MIN = 0.5;
// pendência ("ainda não", "a definir", "em análise", "aguarda") — não é decisão nem proposta
const RE_PENDING = /\b(?:ainda\s+nao|a\s+(?:definir|decidir|deliberar|aprovar)|a\s+ser(?:em)?\s+(?:definid|decidid|aprovad|deliberad)\w*|em\s+(?:discussao|analise|tramitacao|andamento)|aguard\w+|pendente|nao\s+ha\s+previsao)\b/;
const RESULT_PART = /^(?:aprovad|reprovad|deferid|indeferid|homologad|rejeitad|negad|autorizad|referendad|ratificad|vetad|recusad|acatad|aceit|acolhid)/;
const STRONG_DEC_PART = /^(?:decidid|definid|deliberad|acordad|consensuad|pactuad)/;
function calibrateConfidence(kind, sig) {
  const ev = [];
  let sc = 0;
  const base = (v, txt) => { sc = v; ev.push({ sinal: '=', texto: txt }); };
  const add = (v, txt) => { sc += v; ev.push({ sinal: v >= 0 ? '+' : '−', texto: txt }); };
  const g = sig.gatilho ? '«' + sig.gatilho + '»' : '';
  if (kind === 'decisoes') {
    const part = fold(sig.part || '');
    if (sig.kind === 'frame' && (RESULT_PART.test(part) || STRONG_DEC_PART.test(part))) base(0.76, 'construção deliberativa explícita com resultado ' + g);
    else if (sig.kind === 'frame') base(0.68, 'construção de decisão com verbo menos específico ' + g);
    else if (sig.kind === 'se') base(0.74, 'verbo deliberativo explícito ' + g);
    else if (sig.kind === 'agente') base(0.74, 'sujeito + verbo deliberativo explícito ' + g);
    else if (sig.kind === 'start') base(0.66, 'frase começa pelo resultado ' + g);
    else if (sig.kind === 'consenso') base(0.62, 'registro de consenso ' + g);
    else if (sig.kind === 'voto') base(0.56, 'apenas o resultado de votação, sem o objeto da decisão');
    else if (sig.kind === 'rotulo') base(0.6, 'trecho sob o rótulo "Decisão"');
    else base(0.6, 'indício de decisão ' + g);
    if (sig.voto) add(0.12, 'resultado de votação explícito (unanimidade, maioria, abstenções…)');
    if (sig.coletivo) add(0.03, 'o colegiado/órgão aparece como quem decide');
  } else if (kind === 'encaminhamentos') {
    const B = { atribuicao: [0.74, 'atribuição explícita de responsabilidade'], compromisso: [0.74, 'compromisso explícito assumido'],
      encaminhado: [0.7, 'registro de encaminhamento'], rotulo: [0.66, 'trecho sob o rótulo "Encaminhamentos"'],
      infinitivo: [0.66, 'tarefa listada no infinitivo sob rótulo de ações'], obrigacao: [0.64, 'obrigação futura ("deverá…")'],
      passiva_futura: [0.62, 'ação futura na voz passiva'], futuro_ir: [0.58, 'ação futura ("irá…")'], futuro_nos: [0.56, 'ação futura na 1ª pessoa'],
      futuro_ativo: [0.55, 'verbo de ação no futuro'], obrigacao_presente: [0.5, 'obrigação no presente ("deve…")'],
      futuro_ambiguo: [0.45, 'futuro de verbo ambíguo'], tabela: [0.7, 'linha de tabela de ações'] };
    const b = B[sig.cue] || [0.55, 'indício de ação futura'];
    base(b[0], b[1] + (g && sig.cue !== 'tabela' ? ' ' + g : ''));
    if (sig.cabecalhoTabela) add(0.14, 'tabela com cabeçalho de ação/responsável/prazo');
    if (sig.responsavel) add(0.08, 'responsável identificado (' + sig.responsavel + ')');
    if (sig.prazo) add(0.08, 'prazo relacionado à ação (' + sig.prazo + ')');
    if (sig.decidido) add(0.06, 'a ação decorre de decisão registrada na mesma frase');
    if (sig.rotuloExtra) add(0.06, 'confirmado por rótulo de encaminhamento');
  } else if (kind === 'sugestoes') {
    if (sig.via === 'verbo') base(0.74, 'verbo explícito de sugestão/proposta ' + g);
    else if (sig.via === 'formal') base(0.56, 'proposta formal apresentada, sem verbo de sugestão ' + g);
    else base(0.5, 'formulação hipotética ' + g + ' — pode ser só um comentário');
    if (sig.proponente) add(0.06, 'autor identificado (' + sig.proponente + ')');
  } else if (kind === 'demandas') {
    if (sig.via === 'pedido') base(0.7, 'ato explícito de pedir ' + g);
    else if (sig.via === 'titulo') base(0.7, 'o próprio item da pauta é uma solicitação');
    else if (sig.via === 'nominal') base(0.62, 'registro nominal de pedido ' + g);
    else base(0.56, 'necessidade declarada ' + g + ', sem pedido explícito');
    if (sig.solicitante) add(0.06, 'quem pediu está identificado (' + sig.solicitante + ')');
  } else if (kind === 'problemas') {
    if (sig.via === 'impedimento') base(0.7, 'impedimento explícito ' + g);
    else if (sig.via === 'relato') base(0.66, 'obstáculo relatado ' + g);
    else base(0.56, 'termo de dificuldade ' + g + ' sem relato explícito');
    if (sig.estado) add(0.04, 'descrito como situação existente');
    if (sig.pistas > 1) add(0.04, 'mais de um indício de obstáculo na frase');
  }
  // ---- estrutura ----
  if (sig.bloco) add(sig.blocoPauta ? 0.06 : 0.04, 'está no bloco do item «' + clip(sig.bloco, 70) + '»');
  if (sig.rotulo && kind === 'decisoes') add(0.08, 'confirmado por rótulo "Decisão"');
  if (sig.destaque && (kind === 'decisoes' || kind === 'encaminhamentos')) add(0.04, 'trecho destacado na formatação da ata (negrito/itálico)');
  if (sig.ocr) add(-0.05, 'texto obtido por OCR (reconhecimento de imagem): pode haver erros de leitura');
  // ---- relação com o assunto ----
  if (sig.relacionadoAoBloco) add(0.03, 'trata do mesmo tema do assunto do bloco');
  // ---- contexto ----
  if (sig.relatado) { add(-0.12, 'aparece dentro de um relato ("informou que…"): pode ser só contexto'); }
  if (sig.hipotese) add(-0.3, 'linguagem de hipótese ou pendência ("ainda não", "a definir", "talvez")');
  if (sig.condicao) add(-0.12, 'formulação condicional ("caso", "se houver")');
  if (sig.contextoAnterior) add(-0.05, 'só faz sentido junto da frase anterior (incluída)');
  if (sig.sublista) add(-0.02, 'item de lista dentro do assunto');
  // ---- consistência ----
  const pos = ev.filter(e => e.sinal === '+').length, neg = ev.filter(e => e.sinal === '−').length;
  if (pos >= 3 && !neg) add(0.03, 'evidências independentes e consistentes entre si');
  if (pos && neg >= 2) add(-0.03, 'evidências em sentidos opostos');
  if (sig.relatado) sc = Math.min(sc, 0.72);                // relato nunca chega a confiança alta
  sc = Math.max(0, Math.min(0.97, sc));
  return { score: +sc.toFixed(2), evidencias: ev };
}
const CONF_TEXT = {
  alta: 'há evidências claras no texto e/ou na estrutura da ata',
  'média': 'há indícios relevantes, mas a interpretação depende do contexto',
  baixa: 'a identificação é incerta; confira o trecho na ata original'
};

/* ============================================================
   EXTRAÇÃO POR BLOCO
============================================================ */
const RE_SUBNUM = /^\d{1,2}\s*[.)]\s+(?=\S)/;
function toUnits(lines) {
  const units = [];
  let cur = null, afterBlank = true;
  const pushCur = () => { if (cur) units.push(cur); cur = null; };
  lines.forEach(raw => {
    const t = raw.trim();
    if (!t) { pushCur(); afterBlank = true; return; }
    if (t.indexOf(SUB_MARK) === 0) { pushCur(); units.push({ sub: t.slice(SUB_MARK.length) }); afterBlank = true; return; }
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(t)) { pushCur(); afterBlank = true; return; }       // link solto
    const fld = !/^(?:encaminhamentos?|providencias|decis|delibera|resolu|prazo|data\s+limite|respons)/i.test(fold(t)) ? fieldAt(t) : null;
    if (fld) { pushCur(); units.push({ text: t, campo: true, paraStart: true }); afterBlank = true; return; }
    // tabela: tabulação ou barras
    const cells = (t.indexOf('\t') >= 0 ? t.split(/\t+/) : (/\s\|\s|^\|/.test(t) ? t.split('|') : [t])).map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) { pushCur(); units.push({ cells, text: t, paraStart: afterBlank }); afterBlank = false; return; }
    const lab = fold(t).match(/^(encaminhamentos?|providencias|acoes(?:\s+a\s+\w+)?|pendencias|tarefas|proximos\s+passos|decisoes?|deliberacoes?|resolucoes?)\s*[:\-–]\s*(.*)$/);
    if (lab) {
      pushCur();
      const type = /^(?:decis|delib|resol)/.test(lab[1]) ? 'decisao' : 'encaminhamento';
      const rest = t.slice(t.indexOf(':') >= 0 ? t.indexOf(':') + 1 : t.search(/[-–]/) + 1).trim();
      units.push({ label: type, text: rest, paraStart: true });
      afterBlank = false; return;
    }
    // marcador de lista, inclusive sublista numerada que NÃO é cabeçalho da ata ("1. Discente A…")
    if (RE_LIST.test(t) || RE_SUBNUM.test(t)) { pushCur(); cur = { text: t.replace(RE_LIST, '').replace(RE_SUBNUM, '').trim(), listItem: true, paraStart: afterBlank }; afterBlank = false; return; }
    if (cur && !cur.listItem && !afterBlank) { cur.text += ' ' + t; return; }
    if (cur && cur.listItem && !afterBlank && /^[a-zà-ú]/.test(t)) { cur.text += ' ' + t; return; }   // continuação de item
    pushCur();
    cur = { text: t, paraStart: afterBlank };
    afterBlank = false;
  });
  pushCur();
  return units;
}

const RE_INTRO = [
  { re: /\b(?:passando|passou-se|passou|passamos|passaram|seguindo|prosseguindo|prosseguiu-se|dando\s+prosseguimento)\b[^.]{0,40}?\bao?\s+(?:item|ponto|assunto)\s+(\d{1,2})\b\s*[,:\-–]?\s*(.*)/, num: true, conf: 0.7 },
  { re: /\b(?:tratou-se|trataram-se|discutiu|discutiram|debateu|debateram|trataram|abordaram|abordou|analisaram|discutiu-se|discutiram-se|debateu-se|debateram-se|abordou-se|abordaram-se|analisou-se|analisaram-se|iniciou-se\s+a\s+discussao|passou-se\s+a\s+discussao|deu-se\s+inicio\s+a\s+discussao|foi\s+(?:discutid|debatid|abordad|analisad|tratad)[oa]|foram\s+(?:discutid|debatid|abordad|analisad|tratad)[oa]s)\s+(?:(?:o|a|os|as)\s+)?(?:(?:assunto|tema|questao|pauta|ponto|proposta)\s+)?(?:sobre|acerca\s+d[eao]s?|a\s+respeito\s+d[eao]s?|referente\s+a|relativ[oa]s?\s+a|d[eao]s?)\s+(.{6,110}?)(?=[.;:]|\s+(?:que|onde|sendo|conforme|tendo|devido|em\s+razao|visto|pois|porque|ficou|foi|foram|com\s+o\s+objetivo)\b|$)/, conf: 0.66 },
  { re: /\b(?:o|a)\s+(?:coordenador[a]?|presidente|secretari[ao]|professor[a]?)\s+(?:\w+\s+){0,3}?(?:apresentou|trouxe|colocou|submeteu|levou|iniciou|abriu|expos)\s+(?:ao\s+(?:colegiado|plenario|grupo)\s+)?(?:(?:o|a|os|as)\s+)?(?:assunto|tema|questao|pauta|ponto|proposta)\s+(?:sobre|acerca\s+d[eao]s?|referente\s+a|relativ[oa]\s+a|d[eao]s?)\s+(.{6,110}?)(?=[.;:]|\s+(?:que|onde|sendo|conforme|tendo|devido|visto|pois|porque)\b|$)/, conf: 0.55 },
  { re: /^(?:sobre|quanto\s+(?:a|ao|aos|as)|em\s+relacao\s+(?:a|ao|aos|as)|no\s+que\s+(?:se\s+)?(?:refere|diz\s+respeito)\s+(?:a|ao|aos|as)|no\s+tocante\s+(?:a|ao|aos|as)|acerca\s+d[eao]s?|a\s+respeito\s+d[eao]s?|relativamente\s+(?:a|ao|aos|as)|referente\s+(?:a|ao|aos|as))\s+(.{6,110}?)(?=[,.;:])/, conf: 0.5 },
  { re: /^(?:assunto|tema|pauta|ponto)\s*(?:\d+)?\s*[:\-–]\s*(.{4,110}?)(?:[.;]|$)/, conf: 0.75 }
];
function detectIntroSubject(orig, n, pautaByNum) {
  for (const p of RE_INTRO) {
    const m = n.match(p.re);
    if (!m) continue;
    if (p.num) {
      const num = +m[1];
      if (pautaByNum && pautaByNum.has(num)) return { title: pautaByNum.get(num), conf: 0.85, origem: 'frase de transição + pauta' };
      const rest = m[2] ? orig.slice(orig.length - (n.length - n.indexOf(m[2], m.index))).trim() : '';
      const t = cleanTitle(rest.replace(/^(?:o|a)\s+/i, ''));
      return t ? { title: t, conf: p.conf, origem: 'frase de transição' } : null;
    }
    const idx = n.indexOf(m[1], m.index);
    const t = cleanTitle(orig.slice(idx, idx + m[1].length).replace(/^(?:(?:o|a|os|as|um|uma)\s+)/i, ''));
    return t ? { title: t, conf: p.conf, origem: 'frase introdutória' } : null;
  }
  return null;
}

function tokenSet(s) {
  return new Set((fold(s).match(/[a-z]{4,}/g) || []).filter(w => !STOP_F.has(w)).map(w => w.slice(0, 5)));
}
function matchPautaItem(text, items) {
  const ts = tokenSet(text);
  let best = null;
  items.forEach(it => {
    const its = tokenSet(it.title);
    if (!its.size) return;
    let shared = 0; its.forEach(t => { if (ts.has(t)) shared++; });
    const ok = (its.size <= 3 && shared >= 1 && shared / its.size >= 0.5) || shared >= 2;
    if (ok && (!best || shared > best.shared)) best = { it, shared };
  });
  return best ? best.it : null;
}

const STOP_F = new Set(Array.from(STOPWORDS).map(fold));

function extractItems(struct, ctx) {
  let sentNo = 0;                 // contador global de sentenças (mede distância entre frases)
  const out = { decisoes: [], encaminhamentos: [], problemas: [], demandas: [], sugestoes: [] };
  const subjects = [];            // assuntos detalhados
  const subjectIdx = new Map();
  const hasStructure = struct.tipo !== 'corrido';
  const pautaItems = struct.pauta ? struct.pauta.items : [];
  const pautaByNum = new Map(pautaItems.map(i => [i.num, i.title]));

  const registerSubject = (title, origem, conf) => {
    if (!title) return null;
    const key = fold(title).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) return null;
    if (!subjectIdx.has(key)) {
      const s = { titulo: title, origem, confianca: conf, nivel: level(conf), discutido: false, decisoes: 0, encaminhamentos: 0, problemas: 0, demandas: 0, sugestoes: 0, procedural: isProceduralSubject(title) };
      subjectIdx.set(key, s); subjects.push(s);
    }
    return subjectIdx.get(key);
  };
  if (struct.pauta) pautaItems.forEach(it => registerSubject(it.title, 'pauta', 0.88));

  struct.blocks.forEach((block, blockIdx) => {
    if (block.kind === 'presenca' || block.kind === 'encerramento') return;
    let current = block.title ? registerSubject(block.title, block.origem, block.conf) : null;
    const units = toUnits(block.lines);
    let labelType = null, prevSent = null, lastItem = null, lastRefs = null;
    let blockDecision = null, decSubj = null, decSentNo = 0;   // decisão vigente neste assunto
    let currentSub = null;                                     // subtítulo ("a) …") dentro do bloco
    let tableHeader = null;

    const bump = (kind) => { if (current) current[kind]++; };
    const addItem = (kind, item, sig) => {
      if (sig) {
        // trecho inteiro em negrito/itálico no corpo do PDF (só quando a ênfase é exceção no documento)
        if (ctx.enfase.length) { const f = fold(squash(item.descricao)).slice(0, 70); if (f.length >= 25 && ctx.enfase.some(e => e.indexOf(f) >= 0)) sig.destaque = true; }
        if (ctx.ocr) sig.ocr = true;
        // sinais comuns: estrutura e relação com o assunto do bloco
        if (current && current.origem && !/frase/.test(current.origem)) { sig.bloco = current.titulo; sig.blocoPauta = /pauta/.test(current.origem); }
        if (current && current.titulo && titleSim(item.descricao, current.titulo) >= 0.34) sig.relacionadoAoBloco = true;
        const cal = calibrateConfidence(kind, sig);
        if (cal.score < CONF_MIN) return false;                 // evidência insuficiente: não classificar
        item.confianca = cal.score;
        item.nivel = level(cal.score);
        item.evidencias = cal.evidencias;
      }
      if (current) item.assunto = current.titulo;
      if (currentSub) item.subassunto = currentSub;
      item.ordem = ++ctx.ord;                                   // posição na ata (relação anterior/posterior)
      Object.defineProperty(item, '_blk', { value: blockIdx, enumerable: false, writable: true });
      if (!item.fonte) item.fonte = 'sentença';                 // de onde veio a evidência
      if (kind === 'decisoes') { blockDecision = item; decSubj = current; decSentNo = sentNo; }
      out[kind].push(item); bump(kind); lastItem = item;
      return true;
    };

    units.forEach(u => {
      if (u.sub) {
        currentSub = u.sub; labelType = null; prevSent = null;
        if (current) { current.subtopicos = current.subtopicos || []; if (!current.subtopicos.includes(u.sub)) current.subtopicos.push(u.sub); }
        return;
      }
      if (u.campo) { prevSent = null; return; }            // "Disciplina: X" é dado do item, não frase classificável
      if (u.label) { labelType = u.label; if (!u.text) return; u = { text: u.text, listItem: false, paraStart: true, forcedLabel: u.label }; }
      else if (u.paraStart && !u.listItem && !u.cells) labelType = null;

      /* ---- tabelas ---- */
      if (u.cells) {
        const folded = u.cells.map(fold);
        const hAcao = folded.findIndex(c => /^(?:acao|acoes|encaminhamento|encaminhamentos|providencia|atividade|tarefa|demanda|descricao)/.test(c));
        const hDec = folded.findIndex(c => /^(?:decisao|deliberacao|resultado)/.test(c));
        const hResp = folded.findIndex(c => /^respons/.test(c));
        const hPrazo = folded.findIndex(c => /^(?:prazo|data|quando|periodo)/.test(c));
        if ((hAcao >= 0 || hDec >= 0) && (hResp >= 0 || hPrazo >= 0 || folded.length <= 3)) { tableHeader = { hAcao, hDec, hResp, hPrazo }; return; }
        const row = tableHeader ? {
          desc: u.cells[tableHeader.hDec >= 0 ? tableHeader.hDec : tableHeader.hAcao],
          resp: tableHeader.hResp >= 0 ? u.cells[tableHeader.hResp] : null,
          prazo: tableHeader.hPrazo >= 0 ? u.cells[tableHeader.hPrazo] : null,
          kind: tableHeader.hDec >= 0 ? 'decisoes' : 'encaminhamentos'
        } : null;
        let r = row;
        if (!r) {
          const T0 = u.cells.map(c => findTemporal(c, ctx).principal);
          const pi = T0.findIndex(Boolean);
          let longest = u.cells.findIndex(c => wordsOf(c).length >= 3 && !findTemporal(c, ctx).principal);
          if (longest < 0) longest = u.cells.reduce((a, c, i) => c.length > u.cells[a].length ? i : a, 0);
          r = { desc: u.cells[longest], prazo: pi >= 0 && pi !== longest ? u.cells[pi] : null, resp: null, kind: null };
        }
        if (!r.desc || wordsOf(r.desc).length < 3) return;
        const ents = r.resp ? parseEntities(r.resp, ctx.participantes) : [];
        const T = r.prazo ? findTemporal(r.prazo, ctx) : null;
        let kind = r.kind;
        if (!kind) {
          const d = scoreDecision(r.desc, fold(r.desc), fold(r.desc).replace(/[,;()"“”]/g, ' '), wordsOf(r.desc), { labelType });
          kind = d ? 'decisoes' : ((ents.length || T) ? 'encaminhamentos' : null);
        }
        if (!kind) return;
        const item = { descricao: clip(squash(r.desc), 600), confianca: row ? 0.88 : 0.7, gatilho: 'linha de tabela', fonte: 'tabela' };
        const sigT = kind === 'decisoes' ? { kind: 'frame', part: (fold(r.desc).match(new RegExp(DEC_PART)) || [''])[0], gatilho: 'linha de tabela' }
                                         : { cue: 'tabela', cabecalhoTabela: !!row };
        applyActors(item, ents);
        if (T && T.principal) applyPrazo(item, withRoles(T, 'rotulo'), r.prazo, true);
        else if (r.prazo && !/^[-–—\s]*$/.test(r.prazo)) { item.prazo = squash(r.prazo); item.prazoTipo = 'indefinido'; }
        if (kind === 'encaminhamentos') item.acao = clip(squash(r.desc), 220);
        const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140) + '|' + blockIdx;   // duplicata só dentro do mesmo bloco
        if (ctx.seen.has(kind + key)) return;
        ctx.seen.add(kind + key);
        if (kind === 'encaminhamentos') { sigT.responsavel = item.responsavel; sigT.prazo = item.prazo; }
        addItem(kind, item, sigT);
        return;
      }

      /* ---- texto corrido / listas ---- */
      const sentences = splitSentences(u.text);
      sentences.forEach(sentRaw => {
        let orig = sentRaw.replace(RE_SUBNUM, '');               // enumerador de sublista não é conteúdo
        let sentLabel = u.forcedLabel || null;
        const lm = fold(orig).match(/^(decisao|deliberacao|resolucao|encaminhamentos?|providencias)\s*[:\-–]\s*/);
        if (lm) { sentLabel = /^(?:decis|delib|resol)/.test(lm[1]) ? 'decisao' : 'encaminhamento'; orig = cap1(orig.slice(lm[0].length)); }
        orig = squash(orig);
        if (orig.length < 8 || orig.length > 1400) return;
        sentNo++;
        const n = fold(orig);
        const lc = orig.toLowerCase();
        const m = n.replace(/[,;()"“”]/g, ' ').replace(/\s+/g, ' ').trim();
        const toks = orig.split(/\s+/);
        const sctx = { listItem: !!u.listItem, labelType: sentLabel || labelType };

        // "Prazo: ..." / "Responsável: ..." logo após um item -> complementa o item anterior
        const orph = n.match(/^(prazo|data\s+limite|responsaveis?)\s*[:\-–]\s*(.+)$/);
        if (orph && wordsOf(orig).length <= 18 && lastItem) {
          const restOrig = orig.slice(orig.indexOf(':') + 1 || orig.search(/[-–]/) + 1).trim();
          if (/^(?:prazo|data)/.test(orph[1])) { const T = findTemporal(restOrig, ctx); if (T.principal) applyPrazo(lastItem, withRoles(T, 'rotulo'), restOrig, true); else if (!lastItem.prazo) { lastItem.prazo = trimEnd(restOrig); lastItem.prazoTipo = 'indefinido'; } }
          else { const ents = parseEntities(restOrig.replace(/[.;].*$/, ''), ctx.participantes); applyActors(lastItem, ents); }
          return;
        }

        // assunto por frase introdutória: só quando a ata NÃO tem estrutura
        if (!hasStructure && !pautaItems.length) {
          const intro = detectIntroSubject(orig, n, pautaByNum);
          if (intro) current = registerSubject(intro.title, intro.origem, intro.conf) || current;
        } else if (!hasStructure && pautaItems.length) {
          const intro = detectIntroSubject(orig, n, pautaByNum);
          let hit = null;
          if (intro) {
            const pm = matchPautaItem(intro.title, pautaItems);
            if (pm) hit = registerSubject(pm.title, 'pauta', 0.88);
            else if (intro.origem === 'frase de transição + pauta') hit = registerSubject(intro.title, intro.origem, intro.conf);
          }
          if (hit) current = hit;
          else if (u.paraStart) { const pm = matchPautaItem(orig, pautaItems); if (pm) current = registerSubject(pm.title, 'pauta', 0.88); }
        }

        if (/\?\s*$/.test(orig)) { if (current) current.discutido = true; prevSent = { text: orig }; lastRefs = null; return; }
        if (RE_DISCUSS.test(m) && current) current.discutido = true;

        const dec = scoreDecision(orig, n, m, toks, sctx);
        const enc = scoreEncaminhamento(orig, n, m, lc, toks, sctx, dec);
        const T0 = (dec || (enc && enc.score >= 0.4)) ? findTemporal(orig, ctx) : null;
        // ação sob rótulo "Encaminhamentos:" ou no infinitivo ("Marcar reunião … no próximo semestre")
        // É a própria obrigação: a referência temporal dela é prazo
        const encIsDuty = sctx.labelType === 'encaminhamento' || (enc && ['rotulo', 'infinitivo'].includes(enc.cue.tipo));
        const Td = withRoles(T0, 'decisao', lc), Te = withRoles(T0, encIsDuty ? 'rotulo' : 'encaminhamento', lc);
        let produced = [];

        if (dec) {
          let desc = orig, contexto = false;
          if (dec.anaphoric && prevSent && prevSent.text && prevSent.text.length <= 450 && !(lastRefs && (lastRefs.dec || lastRefs.enc))) {
            desc = prevSent.text.replace(/[.!]+$/, '') + '. ' + orig; contexto = true;
          }
          // ALTA exige estrutura + gatilho forte: estar no bloco de um item da pauta/cabeçalho soma um pouco
          const structBonus = current && current.origem && !/frase/.test(current.origem) ? 0.04 : 0;
          const item = { descricao: clip(squash(desc), 600), confianca: +Math.min(0.97, dec.score + structBonus).toFixed(2), gatilho: dec.gatilho, ...(contexto ? { contexto: true } : {}) };
          const explicitEnts = extractActors(orig, n, -1, ctx, true, { pastAgent: false });
          applyActors(item, explicitEnts);
          applyPrazo(item, Td, orig, true);
          const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140) + '|' + blockIdx;   // duplicata só dentro do mesmo bloco
          const rcsD = reportComplementStart(m);
          const sigD = { kind: dec.kind, part: dec.part, gatilho: dec.gatilho, voto: RE_VOTE.test(m), coletivo: RE_COLLECTIVE.test(m) && dec.kind === 'agente',
            rotulo: sctx.labelType === 'decisao' && dec.kind !== 'rotulo', relatado: rcsD >= 0 && dec.at >= rcsD && dec.kind !== 'rotulo',
            hipotese: RE_HEDGE.test(m) && dec.kind !== 'rotulo', condicao: RE_COND.test(m), contextoAnterior: contexto, sublista: !!u.listItem };
          if (!ctx.seen.has('decisoes' + key) && addItem('decisoes', item, sigD)) { ctx.seen.add('decisoes' + key); produced.push(['dec', item]); labelType = (/:\s*$/.test(orig) ? 'decisao' : labelType); }
        }

        if (enc && enc.score >= 0.4) {
          const cue = enc.cue;
          const cueStart = cue.infStart != null ? Math.min(cue.start >= 0 ? cue.start : cue.infStart, cue.infStart) : cue.start;
          const passive = ['passiva_futura', 'encaminhado'].includes(cue.tipo);
          let ents = extractActors(orig, n, cue.start >= 0 ? cue.start : (cue.infStart != null ? cue.infStart : -1), ctx, passive, { pastAgent: cue.tipo === 'encaminhado' });
          // papel genérico ("o aluno", "os docentes") só é responsável com obrigação/atribuição explícita
          // ("deverá", "ficará responsável", "se comprometeu", "cabe ao") ou verbo de ação operacional no futuro
          if (ents.length && ents.every(e => e.tipo === 'papel')) {
            const explicitDuty = ['atribuicao', 'compromisso', 'obrigacao', 'obrigacao_presente', 'rotulo', 'infinitivo'].includes(cue.tipo);
            const verbAt = cue.infStart != null ? cue.infStart : cue.start;
            const verb = (n.slice(Math.max(0, verbAt)).match(/^[a-z-]+/) || [''])[0];
            const opFuture = ['futuro_ativo', 'futuro_ir', 'futuro_nos'].includes(cue.tipo) && isOperational(verb);
            const rcs = reportComplementStart(n);
            const inReport = rcs >= 0 && verbAt >= rcs && !['atribuicao', 'compromisso'].includes(cue.tipo);
            if ((!explicitDuty && !opFuture) || inReport) ents = [];
          }
          const hasActor = ents.length > 0;
          let sc = enc.score;
          if (['futuro_ativo', 'futuro_ambiguo'].includes(cue.tipo)) { if (hasActor) sc += 0.15; else sc -= 0.0; }
          if (cue.tipo === 'obrigacao_presente') { if (hasActor) sc += 0.1; if (Te && Te.principal) sc += 0.1; if (/decid|defin|acord|delib|ficou/.test(m)) sc += 0.15; }
          if (['obrigacao', 'futuro_ir'].includes(cue.tipo) && !hasActor && !/\bser\b/.test(n.slice(cue.infStart || 0, (cue.infStart || 0) + 12))) sc -= 0.15;
          if (Te && Te.principal) sc += 0.08;
          // obrigação futura DENTRO de um relato ("ressaltou que, nas próximas reuniões, deverão ser discutidas…"):
          // só entra com prazo/reunião explícitos, e nunca acima de confiança média
          const rcsE = reportComplementStart(n);
          const cueAtE = cue.start >= 0 ? cue.start : (cue.infStart != null ? cue.infStart : -1);
          // "informou que enviará…" (verbo logo após "que", sem sujeito próprio) é compromisso do próprio relator
          const ownSubject = rcsE >= 0 && cueAtE >= rcsE && !/^(?:se|ira|irao|vai|vao)?$/.test(n.slice(rcsE, cueAtE).replace(/[,;]/g, ' ').trim());
          const reportedCue = ownSubject && !['atribuicao', 'compromisso', 'encaminhado', 'rotulo'].includes(cue.tipo);
          if (reportedCue && ['obrigacao', 'passiva_futura'].includes(cue.tipo) && Te && Te.principal &&
              (Te.principal.tipo === 'reuniao' || RE_DEADLINE_LEAD.test(fold(Te.principal.texto)))) sc += 0.12;
          if (reportedCue) sc = Math.min(sc, 0.66);
          // Há decisão vigente neste assunto? Então frase futura/passiva SEM atribuição explícita
          // (rótulo, compromisso, "encaminhado", responsável) é regra decorrente da decisão.
          const firmCue = ['atribuicao', 'compromisso', 'encaminhado', 'rotulo', 'infinitivo'].includes(cue.tipo);
          const bd = (blockDecision && decSubj === current && (sentNo - decSentNo) <= 10) ? blockDecision : null;
          // ação com prazo relacional/reunião futura não é "regra decorrente": é um encaminhamento próprio
          const hasDeadline = !!(Te && Te.principal && (Te.principal.tipo === 'reuniao' || RE_DEADLINE_LEAD.test(fold(Te.principal.texto))));
          const asDetail = !!(bd && !dec && !firmCue && !hasActor && !hasDeadline);
          if (sc >= 0.6 && asDetail) {
            (bd.detalhes = bd.detalhes || []).push({ descricao: clip(squash(orig), 300), gatilho: enc.gatilho || undefined, relacao: 'regra decorrente da decisão' });
            produced.push(['det', null]);
          }
          if (sc >= 0.6 && !asDetail) {
            const item = { descricao: clip(squash(orig), 600), confianca: +Math.min(0.97, sc).toFixed(2), gatilho: enc.gatilho || undefined };
            if (reportedCue) item.relatado = true;
            item.acao = buildAcao(orig, n, cue, Te);
            applyActors(item, ents);
            applyPrazo(item, Te, orig, true);
            if (dec) { item.decidido = true; item.relacao = { tipo: 'decorre de decisão na mesma frase' }; }
            else if (bd) item.relacao = { tipo: 'posterior à decisão do mesmo assunto', decisao: clip(bd.descricao, 140) };
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140) + '|' + blockIdx;   // duplicata só dentro do mesmo bloco
            const sigE = { cue: cue.tipo === 'rotulo' && enc.cue.tipo === 'rotulo' ? 'rotulo' : cue.tipo, gatilho: enc.gatilho,
              responsavel: item.responsavel || null, prazo: hasDeadline || (Te && Te.principal && Te.principal.tipo === 'data') ? item.prazo : null,
              decidido: !!dec, rotuloExtra: sctx.labelType === 'encaminhamento' && cue.tipo !== 'rotulo', relatado: reportedCue,
              hipotese: RE_INTENT.test(m) && !firmCue, condicao: RE_COND.test(m), sublista: !!u.listItem && cue.tipo !== 'infinitivo' };
            if (!ctx.seen.has('encaminhamentos' + key) && addItem('encaminhamentos', item, sigE)) { ctx.seen.add('encaminhamentos' + key); produced.push(['enc', item]); }
          }
        }

        if (!produced.length) {
          const prop = scoreProposal(orig, n, m, toks);
          const dem = scoreDemand(orig, n, m, toks);
          const prob = scoreProblem(orig, n, m, toks);
          if (prop && prop.score >= 0.55 && !(dem && dem.score > prop.score + 0.05 && /solicit|ped/.test(m))) {
            const item = { tipo: prop.tipo, descricao: clip(squash(orig), 600), confianca: +prop.score.toFixed(2), gatilho: prop.gatilho, situacao: 'pendente' };
            const ents = extractActors(orig, n, n.search(RE_PROP_VERB), ctx, false);
            if (ents.length) item.proponente = ents.map(e => e.nome).join(' e ');
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140) + '|' + blockIdx;   // duplicata só dentro do mesmo bloco
            const sigS = { via: prop.via, gatilho: prop.gatilho, proponente: item.proponente || null, condicao: RE_COND.test(m), sublista: !!u.listItem,
              hipotese: prop.via !== 'verbo' && RE_PENDING.test(m) };
            if (!ctx.seen.has('sugestoes' + key) && addItem('sugestoes', item, sigS)) { ctx.seen.add('sugestoes' + key); produced.push(['sug', item]); }
          } else if (dem && (!prob || dem.score >= prob.score)) {
            const item = { tipo: 'demanda', descricao: clip(squash(orig), 600), confianca: +dem.score.toFixed(2), gatilho: dem.gatilho };
            if (dem.kind === 'pedido') {
              const rq = n.match(RE_REQUEST);
              const ents = rq ? extractActors(orig, n, rq.index, ctx, false, { pastAgent: true }) : [];
              if (ents.length) item.solicitante = ents.map(e => e.nome).join(' e ');
            }
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140) + '|' + blockIdx;   // duplicata só dentro do mesmo bloco
            const sigM = { via: dem.kind, gatilho: dem.gatilho, solicitante: item.solicitante || null, condicao: RE_COND.test(m), sublista: !!u.listItem };
            if (!ctx.seen.has('demandas' + key) && addItem('demandas', item, sigM)) { ctx.seen.add('demandas' + key); produced.push(['dem', item]); }
          } else if (prob) {
            const item = { tipo: 'problema', descricao: clip(squash(orig), 600), confianca: +prob.score.toFixed(2), gatilho: prob.gatilho, ...(prob.subtipo ? { subtipo: prob.subtipo } : {}) };
            const key = fold(item.descricao).replace(/[^a-z0-9]+/g, ' ').slice(0, 140) + '|' + blockIdx;   // duplicata só dentro do mesmo bloco
            const sigP = { via: prob.via, gatilho: prob.gatilho, estado: prob.estado, pistas: prob.pistas || 1, relatado: !!prob.relatado, sublista: !!u.listItem };
            if (!ctx.seen.has('problemas' + key) && addItem('problemas', item, sigP)) { ctx.seen.add('problemas' + key); produced.push(['prob', item]); }
          }
        }

        if (!produced.length && blockDecision && decSubj === current && (sentNo - decSentNo) <= 10 && RE_RULE.test(m) && wordsOf(orig).length >= 4) {
          (blockDecision.detalhes = blockDecision.detalhes || []).push({ descricao: clip(squash(orig), 300), relacao: 'regra decorrente da decisão' });
        }
        lastRefs = { dec: produced.some(p => p[0] === 'dec'), enc: produced.some(p => p[0] === 'enc'), sug: (produced.find(p => p[0] === 'sug') || [])[1] || null };
        if (produced.some(p => p[0] === 'enc') && /:\s*$/.test(orig)) labelType = 'encaminhamento';
        prevSent = { text: orig };
      });
    });
  });

  /* ---- quase-duplicatas (DEPOIS da classificação) ----
     Só dentro da MESMA lista (decisão nunca se funde com sugestão; demanda nunca com problema),
     do MESMO bloco e do MESMO subtítulo. Exige quase todo o vocabulário igual (Jaccard ≥ 0.88)
     e NENHUMA diferença de polaridade/resultado ("deferido" × "indeferido", "não"). A versão
     mantida é a de maior confiança, completada com os metadados que só a outra tinha. */
  const POLAR = /\b(?:nao|nem|in(?:deferid|aprovad)\w*|reprovad\w*|rejeitad\w*|negad\w*|deferid\w*|aprovad\w*)\b/g;
  ['decisoes', 'encaminhamentos', 'problemas', 'demandas', 'sugestoes'].forEach(k => {
    const kept = [];
    out[k].forEach(it => {
      const f = fold(it.descricao);
      const ts = new Set(f.match(/[a-z0-9]{3,}/g) || []);
      const pol = (f.match(POLAR) || []).sort().join(' ');
      const dup = kept.find(o => {
        if (o._blk !== it._blk || (o.subassunto || '') !== (it.subassunto || '') || o._pol !== pol) return false;
        const os = o._t; let inter = 0; ts.forEach(t => { if (os.has(t)) inter++; });
        const uni = ts.size + os.size - inter; return uni && inter / uni >= 0.88;
      });
      if (dup) {
        const [win, lose] = it.confianca > dup.confianca ? [it, dup] : [dup, it];
        const merged = Object.assign({}, lose, win);           // metadados do vencedor têm prioridade…
        Object.keys(lose).forEach(key => { if (merged[key] == null) merged[key] = lose[key]; });   // …e nada se perde
        Object.keys(dup).forEach(key => delete dup[key]);
        Object.assign(dup, merged);
        return;
      }
      Object.defineProperty(it, '_t', { value: ts, enumerable: false, writable: true });
      Object.defineProperty(it, '_pol', { value: pol, enumerable: false, writable: true });
      kept.push(it);
    });
    out[k] = kept;
  });
  /* ---- reconciliação: sugestão/proposta x decisões POSTERIORES do mesmo assunto ---- */
  out.sugestoesDeliberadas = reconcileSuggestions(out);
  out.sugestoesDeliberadas.forEach(sg => {
    const k = fold(sg.assunto || '').replace(/[^a-z0-9]+/g, ' ').trim();
    const sb = subjectIdx.get(k);
    if (sb && sb.sugestoes > 0) sb.sugestoes--;
  });

  /* ---- demanda × decisão posterior: só com evidência de que é o MESMO pedido ---- */
  out.demandas.forEach(dm => {
    const ot = simTokens(dm.descricao.replace(/^.*?\b(?:solicit\w*|ped\w*|requer\w*)\b/i, ''));
    const dec = out.decisoes.find(d => {
      if (!(d.ordem > dm.ordem) || d._blk !== dm._blk) return false;
      if (d.subassunto && dm.subassunto && d.subassunto !== dm.subassunto) return false;
      const dt = simTokens(d.descricao); let sh = 0; ot.forEach(x => { if (dt.has(x)) sh++; });
      return sh >= 3;
    });
    if (dec) {
      dm.situacao = 'deliberada';
      dm.relacao = { tipo: 'deliberada em decisão posterior', decisao: clip(dec.descricao, 140), evidencia: 'a decisão trata do mesmo pedido' };
    }
  });

  /* ---- a própria pauta pode ser uma demanda ("Solicitação de…", "Pedido de…") ---- */
  subjects.forEach(sb => {
    if (sb.procedural || !RE_REQ_TITLE.test(fold(sb.titulo))) return;
    if (out.demandas.some(d => d.assunto === sb.titulo)) return;   // o corpo já registrou: não duplica
    const calT = calibrateConfidence('demandas', { via: 'titulo', bloco: sb.titulo, blocoPauta: /pauta/.test(sb.origem || '') });
    const item = { tipo: 'demanda', descricao: sb.titulo, confianca: calT.score, nivel: level(calT.score), evidencias: calT.evidencias, gatilho: 'título é uma solicitação nominal',
      fonte: /pauta/.test(sb.origem || '') ? 'título da pauta' : 'título do bloco', assunto: sb.titulo, ordem: ++ctx.ord, situacao: 'pendente' };
    const tt = simTokens(sb.titulo);
    const dec = out.decisoes.find(d => {
      if (d.assunto !== sb.titulo) return false;
      const fd = fold(d.descricao);
      if (/\b(?:a|o|essa|esse|tal)\s+(?:solicitac\w+|pedido|requerimento|demanda|pleito)\s+(?:\S+\s+){0,4}?(?:foi|foram)\s+(?:\S+\s+)?(?:aprovad|deferid|indeferid|rejeitad|negad|acatad|aceit)/.test(fd)) return true;
      const dt = simTokens(d.descricao); let sh = 0; tt.forEach(x => { if (dt.has(x)) sh++; });
      return sh >= 2;
    });
    if (dec) { item.situacao = 'deliberada'; item.relacao = { tipo: 'deliberada em decisão do mesmo assunto', decisao: clip(dec.descricao, 140), evidencia: 'a decisão trata do mesmo pedido' }; }
    out.demandas.push(item); sb.demandas++;
  });
  return { out, subjects };
}

/* ============================================================
   RECONCILIAÇÃO  sugestão/proposta  ×  decisão posterior
   Não exige que a decisão seja a frase seguinte: compara o CONTEÚDO
   (tokens substantivos) com qualquer decisão posterior do mesmo bloco/assunto.
============================================================ */
const SIM_STOP = new Set(('sugeriu sugeriram sugestao sugestoes sugerido sugere propos propoe proposta propostas proposto fosse fossem seja sejam ' +
  'dado dada dados dadas foram sido sendo colegiado grupo membros aprovado aprovada aprovados aprovadas aprovou aprovaram unanimidade maioria ' +
  'decidido decidiu definido definiu deliberou deliberado rejeitado rejeitada rejeitou para pela pelo pelas pelos com por uma uns umas que como ' +
  'mais seus suas esse essa este esta sobre entre quando apos antes ainda tambem assim entao nessa nesse nesta neste dessa desse dele dela ' +
  'eles elas aquele aquela havia houve haja dos das nos nas aos sua seu foi ser sera serao').split(/\s+/));
function simTokens(txt) {
  const out = new Set();
  (fold(txt).match(/[a-z0-9]{3,}/g) || []).forEach(w => { if (!SIM_STOP.has(w) && !/^\d+$/.test(w)) out.add(w.slice(0, 5)); });
  return out;
}
// Decisão que se refere explicitamente à proposta/sugestão: "a proposta foi aprovada",
// "a sugestão do prof. X foi acatada", "aprovada a proposta", "conforme sugerido"
const RE_SUG_ANAPHOR = /\b(?:a|essa|esta|tal|referida)\s+(?:proposta|sugestao|recomendacao|proposicao|indicacao\s+sugerida)(?:\s+(?:d[aeo]s?|apresentada\s+pel[ao])\s+(?:\S+\s+){1,4}?)?\s*(?:foi|foram|ficou|fica)\s+(?:\S+\s+)?(?:aprovad|acatad|aceit|rejeitad|reprovad|incorporad|acolhid|indeferid|deferid|recusad)|\b(?:aprovad|acatad|aceit|rejeitad|incorporad|acolhid|recusad)[oa]s?\s+(?:a|as)\s+(?:proposta|propostas|sugestao|sugestoes)\b|\bconforme\s+(?:sugerido|proposto|recomendado)\b/;
/* Uma sugestão só é marcada como deliberada com EVIDÊNCIA de que AQUELA sugestão foi decidida:
     (a) a decisão se refere explicitamente à proposta/sugestão (RE_SUG_ANAPHOR), ou
     (b) a decisão repete o CONTEÚDO da sugestão (o que vem depois de "sugeriu/propôs"):
         ≥ 3 termos substantivos em comum, ou ≥ 2 quando a sugestão tem até 3 termos e todos coincidem.
   E sempre no mesmo bloco estrutural (e no mesmo subtítulo, se houver). Estar no mesmo assunto,
   sozinho, NÃO basta: "João sugeriu incluir X" ≠ "A indicação de Y foi aprovada". */
function suggestionObject(desc) {
  const f = fold(desc);
  const x = f.match(RE_PROP_VERB);
  return x ? desc.slice(x.index + x[0].length) : desc;
}
function reconcileSuggestions(out) {
  const removed = [], keep = [];
  out.sugestoes.forEach(sg => {
    const st = simTokens(suggestionObject(sg.descricao));
    let best = null;
    out.decisoes.forEach(d => {
      if (!(d.ordem > sg.ordem)) return;                                   // só decisões POSTERIORES
      if (d._blk !== sg._blk) return;                                      // mesmo bloco estrutural
      if (d.subassunto && sg.subassunto && d.subassunto !== sg.subassunto) return;
      const fd = fold(d.descricao);
      const dt = simTokens(d.descricao);
      let shared = 0; st.forEach(t => { if (dt.has(t)) shared++; });
      const anaphor = RE_SUG_ANAPHOR.test(fd) && (d.ordem - sg.ordem) <= 8;
      const content = shared >= 3 || (shared >= 2 && st.size <= 3 && shared === st.size);
      if (!anaphor && !content) return;
      const score = (anaphor ? 1 : 0) + shared * 0.1 - (d.ordem - sg.ordem) * 0.01;
      if (!best || score > best.score) best = { d, score, anaphor, shared };
    });
    if (!best) { keep.push(sg); return; }
    const rej = /\b(?:rejeitad|reprovad|indeferid|negad|recusad|vetad)|nao\s+foi\s+aprovad/.test(fold(best.d.descricao));
    sg.situacao = rej ? 'rejeitada' : 'deliberada';
    const evid = best.anaphor ? 'a decisão se refere explicitamente à proposta' : 'a decisão repete o conteúdo da sugestão (' + best.shared + ' termos em comum)';
    sg.relacao = { tipo: 'deliberada em decisão posterior', decisao: clip(best.d.descricao, 140), evidencia: evid };
    best.d.origemProposta = { descricao: sg.descricao, tipo: sg.tipo, proponente: sg.proponente || null, resultado: sg.situacao, evidencia: evid };
    best.d.relacao = best.d.relacao || { tipo: (rej ? 'rejeita' : 'delibera') + ' proposta/sugestão anterior' };
    removed.push(sg);
  });
  out.sugestoes = keep;
  return removed;
}

/* ============================================================
   PARTICIPANTES E TERMOS RECORRENTES
============================================================ */
function findAttendance(struct) {
  const out = { presentes: [], ausentes: [], justificadas: [], afastados: [] };
  if (!struct || !struct.rawLines) return out;
  struct.rawLines.forEach((l, i) => {
    if (struct.region[i] !== 'presenca' || !l.t) return;
    const m = l.n.match(RE_ATTEND);
    if (!m) return;
    const nome = squash(l.t.slice(0, m[1].length)).replace(/[\s.·…_-]+$/, '');
    const st = attendStatus(m[2]);
    ({ presente: out.presentes, ausente: out.ausentes, justificada: out.justificadas, afastado: out.afastados })[st].push(nome);
  });
  return out;
}

function findParticipants(text, struct) {
  // lista com status: participantes = quem estava PRESENTE (ausentes não participaram)
  const att = findAttendance(struct);
  if (att.presentes.length) return att.presentes.slice(0, 120);
  const names = [];
  const NAME_RUN = /(?:Prof(?:essor)?a?\.?|Dr\.?a?|Sr\.?a?)?[ \t]*((?:[A-ZÀ-Ú][a-zà-ú'’-]+|[A-ZÀ-Ú]\.)(?:[ \t]+(?:d[aeo]s?|di|von|van)?[ \t]*(?:[A-ZÀ-Ú][a-zà-ú'’-]+|[A-ZÀ-Ú]\.)){1,5})/g;
  const take = s => {
    let m; NAME_RUN.lastIndex = 0;
    while ((m = NAME_RUN.exec(s))) {
      const toks = m[1].split(/\s+/).filter(t => !PART_RE.test(fold(t)));
      if (toks.length < 2 || toks.some(t => CAP_STOP.has(t.replace(/\.$/, '')))) continue;
      const nm = m[1].replace(/\s+/g, ' ');
      if (!names.includes(nm)) names.push(nm);
    }
  };
  if (struct && struct.rawLines && struct.region) struct.rawLines.forEach((l, i) => { if (struct.region[i] === 'presenca' && l.t) take(l.t); });
  const head = text.slice(0, 3500);
  const pm = head.match(/(?:estiveram\s+presentes|presentes\s*:|compareceram|participaram)/i);
  if (pm) {
    let seg = head.slice(pm.index, pm.index + 900).split(/\bPauta\b/)[0].replace(/[ \t]*\n[ \t]*(?=\S)/g, ' ');   // nome quebrado entre linhas
    const re = /([A-Za-zÀ-ú]+)\.\s+(?=[A-ZÀ-Ú])/g; let mm;
    while ((mm = re.exec(seg))) { if (!ABBR.has(fold(mm[1])) && mm[1].length > 1) { seg = seg.slice(0, mm.index + mm[0].length); break; } }
    take(seg);
  }
  return names.slice(0, 60);
}

/* ---------- TERMOS RECORRENTES ----------
   Mede o que é DISCUTIDO, não o que aparece no documento:
     • só entra texto substantivo dos blocos (fora cabeçalho, presença, ausência, assinatura);
     • URLs/e-mails são removidos antes de tokenizar;
     • nomes de pessoas e sobrenomes são excluídos (participantes, linhas de presença/assinatura,
       e nomes que seguem título/cargo: "Prof. …", "discente …");
     • recorrência = em quantos blocos/assuntos o termo aparece, não só a contagem bruta. */
const URL_RE = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|\b[\w-]+\.(?:com|org|net|gov|edu)(?:\.[a-z]{2})?\b\S*/gi;
const NOISE_TERMS = new Set(['https','http','www','html','htm','pdf','docx','link','email','zoom','meet','google','youtube','teams',
  'ausencia','ausencias','ausente','ausentes','justificada','justificadas','justificativa','justificativas','presenca','presencas',
  'presente','presentes','assinatura','assinaturas','anexo','anexos','lavrada','redigida']);
const ATTEND_RE = /ausen\w*\s+justificad|justific\w*\s+(?:a\s+)?ausenc|justificativa\s+de\s+ausenc|ausentes?\s*:|ausentes?\b.*\b(?:justificad|motivo)|estiveram\s+presentes|compareceram|presentes\s*:|lista\s+de\s+presenca|reuniram-se|\bassinaturas?\b|\bassinam\b|lavrei|\blink\b.*\breuniao/;
const ci1 = w => '[' + w.charAt(0).toUpperCase() + w.charAt(0) + ']' + w.slice(1);
const ROLE_BEFORE_NAME = new RegExp('\\b(?:' + ['professor','professora','prof','profa','dr','dra','sr','sra','discente','aluno','aluna','servidor','servidora',
  'coordenador','coordenadora','diretor','diretora','secretário','secretária','secretario','representante','orientador','orientadora',
  'relator','relatora','presidente','docente','estudante','técnico','técnica'].map(ci1).join('|') +
  ')\\.?\\s+((?:[A-ZÀ-Ú][a-zà-ú\'’-]+|[A-ZÀ-Ú]\\.)(?:\\s+(?:d[aeo]s?|di|von|van)?\\s*(?:[A-ZÀ-Ú][a-zà-ú\'’-]+|[A-ZÀ-Ú]\\.)){0,4})', 'g');

function collectNameTokens(struct, participantes, out) {
  const names = new Set();
  const add = w => { const f = fold(String(w).replace(/[.,;:()]/g, '')); if (f.length >= 3 && !PART_RE.test(f)) names.add(f); };
  (participantes || []).forEach(p => p.split(/\s+/).forEach(add));
  // linhas de presença / ausência / assinatura
  const NAME_RUN = /(?:[A-ZÀ-Ú][a-zà-ú'’-]+|[A-ZÀ-Ú]\.)(?:\s+(?:d[aeo]s?|di|von|van)?\s*(?:[A-ZÀ-Ú][a-zà-ú'’-]+|[A-ZÀ-Ú]\.))+/g;
  (struct.rawLines || []).forEach((l, i) => { if (struct.region && struct.region[i] && l.t) (l.t.match(NAME_RUN) || []).forEach(r => r.split(/\s+/).forEach(add)); });
  // nomes que aparecem logo depois de título/cargo em qualquer ponto do texto
  const all = (struct.rawLines || []).map(l => l.t).join('\n');
  let m; ROLE_BEFORE_NAME.lastIndex = 0;
  while ((m = ROLE_BEFORE_NAME.exec(all))) m[1].split(/\s+/).forEach(add);
  // responsáveis já identificados nos itens
  ['decisoes', 'encaminhamentos', 'sugestoes'].forEach(k => (out[k] || []).forEach(it => (it.responsaveis || []).forEach(r => { if (r.nome) r.nome.split(/\s+/).forEach(add); })));
  return names;
}

// verbos de relato/pedido conjugados ("explicou", "solicitou", "receberam") descrevem a narração da ata,
// não o que foi discutido
const RE_VERB_NOISE = new RegExp('^(?:(?:' + REPORT_STEMS + '|solicit|requer|receb|ped|diss|coloc|fal|afirm)\\w*(?:ou|aram|eu|eram|iu|iram)|\\w{3,}(?:aram|eram|iram|avam|ariam|eriam|aremos|eremos))$');
// determinantes/pronomes e adjetivos genéricos: não dizem do que a reunião tratou
const GENERIC_TERMS = new Set(('nesse nessa nesses nessas neste nesta nestes nestas desse dessa desses dessas deste desta destes destas ' +
  'naquele naquela daquele daquela algum alguma alguns algumas nenhum nenhuma diversos diversas varios varias muitos muitas ' +
  'poucos poucas semelhante semelhantes mesma mesmos mesmas outra outros outras forma formas maneira modo vezes ainda apenas ' +
  'somente sempre tambem ' + 'quanto quanta quantos quantas qualquer quaisquer proprio propria proprios proprias').split(/\s+/));
function recurringTerms(struct, participantes, out) {
  const names = collectNameTokens(struct, participantes, out || {});
  // 1. segmentos substantivos: blocos de assunto (sem cabeçalho/presença/encerramento)
  const hasHeadings = struct.blocks.some(b => b.kind === 'assunto');
  let segs = [];
  struct.blocks.forEach(b => {
    if (b.kind === 'presenca' || b.kind === 'encerramento') return;
    if (b.kind === 'abertura' && hasHeadings) return;              // cabeçalho institucional / abertura
    const text = b.lines.filter(l => l.indexOf(SUB_MARK) !== 0).join('\n');
    segs.push(text);
  });
  if (segs.length <= 2) {                                          // ata corrida: cada parágrafo é um "bloco"
    const paras = [];
    segs.forEach(t => t.split(/\n\s*\n/).forEach(p => { if (p.trim()) paras.push(p); }));
    if (paras.length > segs.length) segs = paras;
  }
  // 2. limpeza: URLs fora; frases de presença/ausência/assinatura fora
  segs = segs.map(t => {
    t = t.replace(URL_RE, ' ');
    return splitSentences(t.replace(/\n/g, ' ')).filter(sn => !ATTEND_RE.test(fold(sn))).join(' ');
  }).filter(t => t.trim());
  if (!segs.length) return [];

  // 3. contagem: frequência bruta E número de blocos distintos
  const stat = new Map();
  segs.forEach((t, si) => {
    (t.toLowerCase().match(/[a-zà-ú]{5,}/g) || []).forEach(w => {
      const f = fold(w);
      if (STOP_F.has(f) || NOISE_TERMS.has(f) || GENERIC_TERMS.has(f) || names.has(f) || RE_VERB_NOISE.test(f)) return;
      const e = stat.get(f) || { termo: w, contagem: 0, blocos: new Set() };
      e.contagem++; e.blocos.add(si); stat.set(f, e);
    });
  });
  // plural -> singular
  Array.from(stat.keys()).forEach(k => {
    if (k.length > 5 && /s$/.test(k) && stat.has(k.slice(0, -1))) {
      const sing = stat.get(k.slice(0, -1)), pl = stat.get(k);
      sing.contagem += pl.contagem; pl.blocos.forEach(b => sing.blocos.add(b)); stat.delete(k);
    }
  });
  const multi = segs.length >= 3;
  return Array.from(stat.values())
    .map(e => ({ termo: e.termo, contagem: e.contagem, blocos: e.blocos.size }))
    .filter(e => e.contagem >= 2 && (!multi || e.blocos >= 2 || e.contagem >= 3))   // recorrência ENTRE blocos, ou tema muito discutido
    .sort((a, b) => b.blocos - a.blocos || b.contagem - a.contagem)
    .slice(0, 15);
}

/* ============================================================
   LEITURA FORMATADA
   Remonta o texto da ata (vindo de PDF, com linhas quebradas) em nós legíveis:
     titulo · pauta · secao (cabeçalho de item) · paragrafo · item (lista) · presenca · assinatura
   Usa a MESMA estrutura descoberta pela extração (cabeçalhos, pauta, regiões), de modo que o
   leitor vê o documento como o sistema o entendeu. Nada é reescrito: só quebras de linha mudam.
============================================================ */
const TRANSITION_START = /^(?:em\s+seguida|a\s+seguir|logo\s+apos|passando|passou-se|prosseguindo|dando\s+(?:prosseguimento|continuidade)|seguindo|por\s+fim|finalmente|no\s+(?:item|ponto)|quanto\s+(?:ao|a)|sobre\s+o|com\s+relacao|em\s+relacao|nada\s+mais|item\s+\d|ponto\s+\d|\d{1,2}\s*[.)\-–]\s)/;
function toReadable(rawText, layout) {
  const text = normalizeText(rawText);
  if (!text) return [];
  const st = buildStructure(text, layout);
  const info = st.rawLines, region = st.region, N = info.length;
  const headAt = new Map();
  const skip = new Set();
  st.blocks.forEach(b => { if (b.head) { headAt.set(b.head.line, b); b.head.consumed.forEach(j => skip.add(j)); } });
  const pauta = st.pauta && st.pauta.from >= 0 ? st.pauta : null;
  const lens = info.filter(x => x.t).map(x => x.t.length).sort((a, b) => a - b);
  const p80 = lens.length ? lens[Math.floor(lens.length * 0.8)] : 80;
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  const lineMode = median > 140;                // TXT: cada linha já é um parágrafo
  const nodes = [];
  let para = null, prevLine = '', seenBody = false;
  const flush = () => { if (para) { nodes.push(para); para = null; } prevLine = ''; };
  const startsNewPara = (prev, cur) => {
    if (!prev) return true;
    if (lineMode) return true;
    // linha anterior curta terminando em pontuação = fim de parágrafo no PDF
    return /[.!?:;]["”)]?$/.test(prev) && prev.length < p80 * 0.82;
  };
  const addLine = (t, sec) => {
    // linha de tabela (tabulação ou barras) → nó de tabela, linha a linha
    if (t.indexOf('\t') >= 0 || /\s\|\s|^\|/.test(t)) {
      const cells = (t.indexOf('\t') >= 0 ? t.split(/\t+/) : t.split('|')).map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        if (!para || para.tipo !== 'tabela') { flush(); para = { tipo: 'tabela', linhas: [] }; }
        para.linhas.push(cells); prevLine = ''; return;
      }
    }
    if (para && para.tipo === 'tabela') flush();
    const lm = t.match(/^(\s*(?:[-•*▪●○◦–—]|[a-z]\s*[.)]|\(\s*[a-z0-9]{1,2}\s*\)|\d{1,2}(?:\.\d{1,2})*\s*[.)]))\s+(.*)$/);
    if (lm) { flush(); para = { tipo: 'item', marcador: lm[1].trim(), texto: lm[2] }; prevLine = t; return; }
    if (para && !startsNewPara(prevLine, t)) { para.texto += ' ' + t; prevLine = t; return; }
    if (para && para.tipo === 'item' && /^[a-zà-ú]/.test(t) && !lineMode) { para.texto += ' ' + t; prevLine = t; return; }
    flush();
    para = { tipo: 'paragrafo', texto: t };
    prevLine = t;
  };
  let i = 0;
  // cabeçalho do documento: primeiras linhas curtas, sem ponto final, antes de qualquer corpo
  let headSeen = 0;
  while (i < N && headSeen < 8) {
    const t = info[i].t;
    if (!t) { i++; continue; }
    headSeen++;
    if (headAt.has(i) || region[i] || (pauta && i >= pauta.from)) break;
    let nx = i + 1; while (nx < N && !info[nx].t) nx++;
    const continues = nx < N && nx === i + 1 && /^[a-zà-ú]/.test(info[nx].t);   // prosa quebrada pelo PDF
    const looksHeader = info[i].destaque || isCapsLine(t) || DOC_TITLE_RE.test(info[i].n) || (t.length <= 60 && !RE_FINITE.test(info[i].n));
    if (looksHeader && !continues && t.length <= 140 && !/[.;,]$/.test(t)) {
      nodes.push({ tipo: 'titulo', texto: t }); i++; continue;
    }
    break;
  }
  let closing = false, sig = null;
  const isUrl = x => /^(?:https?:\/\/|www\.)\S+$/i.test(x || '');
  for (; i < N; i++) {
    const t = info[i].t;
    if (skip.has(i)) continue;
    if (pauta && i >= pauta.from && i <= pauta.to) {
      if (i === pauta.from) { flush(); nodes.push({ tipo: 'pauta', itens: pauta.items.map(x => ({ num: x.num, titulo: x.title })) }); }
      continue;
    }
    const b = headAt.get(i);
    if (b) {
      flush();
      nodes.push({ tipo: 'secao', num: b.num, titulo: b.title || cleanTitle(t) || t });
      seenBody = true;
      b.head.body.forEach(x => addLine(x));
      continue;
    }
    if (!t) { flush(); continue; }
    // lista de presença (em qualquer posição, inclusive depois do encerramento)
    if (region[i] === 'presenca') {
      flush();
      const lines = [], registros = [];
      let titulo = null;
      while (i < N && (region[i] === 'presenca' || !info[i].t)) {
        const l = info[i];
        if (l.t) {
          const am = l.n.match(RE_ATTEND);
          if (am) registros.push({ nome: squash(l.t.slice(0, am[1].length)).replace(/[\s.·…_-]+$/, ''), status: attendStatus(am[2]) });
          else if (!registros.length && !lines.length && /:\s*$/.test(l.t) && l.t.length <= 90) titulo = l.t.replace(/\s*:\s*$/, '');
          else lines.push(l.t);
        }
        i++;
      }
      i--;
      const short = lines.filter(l => l.length < p80 * 0.6).length >= lines.length * 0.6;
      nodes.push(Object.assign({ tipo: 'presenca', linhas: short ? lines : (lines.length ? [lines.join(' ')] : []) },
        titulo ? { titulo } : {}, registros.length ? { registros } : {}));
      continue;
    }
    if (region[i] === 'encerramento' && !closing) { flush(); nodes.push({ tipo: 'encerramento' }); closing = true; }
    // subtítulo "a) Secretaria unificada" dentro de uma seção
    const sh = seenBody ? subHeadingAt(info, i) : null;
    if (sh) { flush(); nodes.push({ tipo: 'subsecao', marcador: sh.marcador, titulo: sh.titulo }); continue; }
    // linha de assinatura ("______") abre o bloco de assinatura
    if (/^[_\-–—.·]{5,}$/.test(t)) { flush(); if (closing) { sig = { tipo: 'assinatura', linhas: [] }; nodes.push(sig); } continue; }
    // campo "Rótulo: valor" (o valor pode vir na linha seguinte quando é um link)
    const fld = fieldAt(t);
    if (fld && !/^(?:presentes|ausentes)$/i.test(fld.rotulo) && t.length <= 170) {
      flush();
      let valor = fld.valor;
      if (!valor) { let j = i + 1; while (j < N && !info[j].t) j++; if (j < N && isUrl(info[j].t)) { valor = info[j].t; i = j; } }
      if (valor || /:\s*$/.test(t)) { nodes.push({ tipo: 'campo', rotulo: fld.rotulo, valor }); continue; }
    }
    if (isUrl(t)) { flush(); nodes.push({ tipo: 'campo', rotulo: 'Link', valor: t }); continue; }
    if (closing) {
      // depois do encerramento: linhas curtas sem pontuação final são assinatura (nome, cargo)
      if (sig || (t.length <= 70 && !/[.;:,]$/.test(t) && (!para || /[.!?]["”)]?$/.test(prevLine)))) {
        if (!sig) { flush(); sig = { tipo: 'assinatura', linhas: [] }; nodes.push(sig); }
        sig.linhas.push(t); continue;
      }
    }
    addLine(t);
  }
  flush();
  // parágrafos muito longos (ata em bloco único) viram parágrafos menores, cortados só entre frases,
  // de preferência antes de expressões de transição ("Em seguida", "Passando ao item…")
  const out = [];
  nodes.forEach(nd => {
    if (nd.tipo !== 'paragrafo' || nd.texto.length <= 900) { out.push(nd); return; }
    const sents = splitSentences(nd.texto);
    let acc = '';
    sents.forEach((s, k) => {
      const brk = acc && (acc.length >= 650 || (acc.length >= 260 && TRANSITION_START.test(fold(s))));
      if (brk) { out.push({ tipo: 'paragrafo', texto: acc }); acc = ''; }
      acc = acc ? acc + ' ' + s : s;
      if (k === sents.length - 1 && acc) out.push({ tipo: 'paragrafo', texto: acc });
    });
  });
  out.forEach(nd => { if (nd.texto) nd.texto = squash(nd.texto); });
  for (let k = out.length - 1; k >= 0; k--) if (out[k].tipo === 'assinatura' && !out[k].linhas.length) out.splice(k, 1);
  return out;
}

/* ============================================================
   ORQUESTRADOR
============================================================ */
function extract(rawText, opts) {
  opts = opts || {};
  const text = normalizeText(rawText);
  const avisos = [];
  // data e reunião: primeiro o TEXTO da ata; o nome do ficheiro só como último recurso, marcado
  const fromName = metaFromFilename(opts.filename);
  let data = findMeetingDate(text), dataOrigem = data ? 'texto' : null;
  if (!data && fromName.data) { data = fromName.data; dataOrigem = 'nome do ficheiro'; }
  else if (data && fromName.data && fromName.data !== data) avisos.push('A data encontrada no texto (' + data + ') é diferente da data no nome do ficheiro (' + fromName.data + ').');
  let reuniao = findReuniao(text), reuniaoOrigem = reuniao ? 'texto' : null;
  // título do texto genérico ("Ata da reunião do colegiado", sem tipo nem número) × nome do ficheiro que identifica a reunião
  const generic = reuniao && !/ordin|extraordin|conjunta|solene|\d/i.test(fold(reuniao));
  if ((!reuniao || generic) && fromName.reuniao) {
    if (generic) avisos.push('O texto só identifica a reunião de forma genérica ("' + reuniao + '"); usada a identificação do nome do ficheiro.');
    reuniao = fromName.reuniao; reuniaoOrigem = 'nome do ficheiro';
  }
  if (opts.ocr && opts.ocr.length) avisos.push('Parte do texto foi obtida por OCR (reconhecimento de imagem) e pode conter erros de leitura.');
  const struct = buildStructure(text, opts.layout);
  const participantes = findParticipants(text, struct);
  const presenca = findAttendance(struct);
  const ctx = { meetingISO: data, participantes, seen: new Set(), ord: 0,
    ocr: !!(opts.ocr && opts.ocr.length), enfase: ((opts.layout && opts.layout.enfase) || []).map(e => fold(squash(e))) };
  const { out, subjects } = extractItems(struct, ctx);

  // assuntos: só o que tem evidência estrutural/linguística. Nunca palavras frequentes.
  const detalhe = subjects.filter(s => s.titulo).map(s => ({
    titulo: s.titulo, origem: s.origem, confianca: +s.confianca.toFixed(2), nivel: s.nivel,
    procedural: s.procedural, ...(s.subtopicos ? { subtopicos: s.subtopicos } : {}), discutido: s.discutido || (s.decisoes + s.encaminhamentos + s.problemas + s.demandas + s.sugestoes) > 0,
    contagens: { decisoes: s.decisoes, encaminhamentos: s.encaminhamentos, problemas: s.problemas, demandas: s.demandas, sugestoes: s.sugestoes }
  }));
  const termosRecorrentes = recurringTerms(struct, participantes, out);
  const degraded = (out.decisoes.length + out.encaminhamentos.length) === 0;
  const LIM = 120;
  const result = {
    versao: VERSION, reuniao, data, dataOrigem, reuniaoOrigem,
    ...(avisos.length ? { avisos } : {}),
    assuntos: detalhe.map(d => d.titulo), assuntosDetalhe: detalhe,
    decisoes: out.decisoes.slice(0, LIM), encaminhamentos: out.encaminhamentos.slice(0, LIM),
    problemas: out.problemas.slice(0, LIM), demandas: out.demandas.slice(0, LIM), sugestoes: out.sugestoes.slice(0, LIM),
    sugestoesDeliberadas: (out.sugestoesDeliberadas || []).slice(0, LIM),
    termosRecorrentes, participantes,
    ...(presenca.presentes.length + presenca.ausentes.length + presenca.justificadas.length ? { presenca } : {}),
    estrutura: { tipo: struct.tipo, pauta: struct.pauta ? struct.pauta.items.map(i => i.title) : [], blocos: struct.blocks.filter(b => b.title).length },
    degraded
  };
  if (opts.debug) result._struct = struct;
  return result;
}

return { extract, toReadable, metaFromFilename, normalizeText, buildStructure, splitSentences, findTemporal, findMeetingDate, findReuniao,
  scoreDecision, isProceduralSubject, STOPWORDS, fold, level, VERSION, CONF_TEXT, CONF_MIN };
}));
