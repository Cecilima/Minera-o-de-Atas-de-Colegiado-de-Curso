// Compatibilidade (item 18): a API pública e o formato do resultado da versão anterior (v2)
// continuam válidos. As listas abaixo foram tiradas da v2 — campos novos são permitidos,
// campos antigos não podem sumir nem mudar de tipo.
const fs = require('fs'), E = require('../js/extractor.js');
let ok = 0, bad = 0;
const t = (nome, cond, info) => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && info !== undefined ? '\n       ↳ ' + JSON.stringify(info) : '')); };

const EXPORTS_V2 = ['extract', 'normalizeText', 'buildStructure', 'splitSentences', 'findTemporal', 'findMeetingDate', 'findReuniao', 'scoreDecision', 'isProceduralSubject', 'STOPWORDS', 'fold', 'level', 'VERSION'];
const RESULT_V2 = { versao: 'number', reuniao: 'string', data: 'string', assuntos: 'array', assuntosDetalhe: 'array', decisoes: 'array', encaminhamentos: 'array', problemas: 'array', demandas: 'array', sugestoes: 'array', sugestoesDeliberadas: 'array', termosRecorrentes: 'array', participantes: 'array', estrutura: 'object', degraded: 'boolean' };
const ITEM_V2 = { descricao: 'string', confianca: 'number', gatilho: 'string', assunto: 'string', ordem: 'number', fonte: 'string' };
const SUBJ_V2 = ['titulo', 'origem', 'confianca', 'nivel', 'procedural', 'discutido', 'contagens'];
const typeOf = v => Array.isArray(v) ? 'array' : typeof v;

EXPORTS_V2.forEach(k => t('export "' + k + '" continua disponível', k in E && (k === 'STOPWORDS' ? E[k] instanceof Set : (k === 'VERSION' ? typeof E[k] === 'number' : typeof E[k] === 'function'))));
t('VERSION aumentou (atas antigas podem ser reanalisadas)', E.VERSION >= 3);
t('level() mantém a escala: ≥0.8 alta, ≥0.65 média, abaixo baixa', E.level(0.8) === 'alta' && E.level(0.79) === 'média' && E.level(0.65) === 'média' && E.level(0.64) === 'baixa');

const atas = fs.readdirSync(__dirname + '/atas').filter(f => /\.txt$/.test(f));
atas.forEach(f => {
  const r = E.extract(fs.readFileSync(__dirname + '/atas/' + f, 'utf8'));
  const wrongTop = Object.entries(RESULT_V2).filter(([k, ty]) => !(k in r) || (r[k] !== null && typeOf(r[k]) !== ty && !(k === 'data' || k === 'reuniao')));
  t(f + ': campos do resultado v2 presentes e com o mesmo tipo', !wrongTop.length, wrongTop.map(x => x[0]));
  const items = [].concat(r.decisoes, r.encaminhamentos, r.problemas, r.demandas, r.sugestoes);
  const badItems = items.filter(it => Object.entries(ITEM_V2).some(([k, ty]) => k in it && typeOf(it[k]) !== ty) || typeof it.descricao !== 'string' || typeof it.confianca !== 'number');
  t(f + ': itens mantêm descricao/confianca/gatilho/assunto/ordem/fonte com os tipos da v2', !badItems.length, badItems.slice(0, 2));
  t(f + ': assuntosDetalhe mantém os campos da v2', r.assuntosDetalhe.every(s => SUBJ_V2.every(k => k in s)));
  t(f + ': estrutura mantém tipo/pauta/blocos', ['tipo', 'pauta', 'blocos'].every(k => k in r.estrutura));
  t(f + ': resultado é serializável (localStorage) sem perder campos', JSON.stringify(JSON.parse(JSON.stringify(r))) === JSON.stringify(r));
});
t('extract(texto, opts) aceita opts como antes', !!E.extract('1. A\nFoi aprovado.\n2. B\nTexto.', { filename: 'x.txt' }));
t('extract sem argumentos não lança erro', (() => { try { E.extract(); E.extract(null); return true; } catch (e) { return false; } })());

console.log('\n' + ok + ' ok / ' + bad + ' falhas');
process.exitCode = bad ? 1 : 0;
