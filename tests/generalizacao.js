// Regressão GENERALIZÁVEL — cada asserção testa um comportamento, não uma ata específica.
// ata7: texto REAL extraído de um PDF (cabeçalho/rodapé por página, sobrescritos, lista de presença),
// com nomes de pessoas e matrícula ANONIMIZADOS (pseudônimos). ata8: fictícia, 2 páginas, outra instituição.
// A ata ata5-pdf-quebras.txt é sintética (instituição e nomes fictícios) e reproduz falhas
// observadas em atas reais: títulos quebrados pelo PDF, sublistas numeradas dentro de um item,
// relatos ("relatou que recebeu um pedido"), agentes da passiva, períodos de contexto.
const fs = require('fs'), E = require('../js/extractor.js');
let ok = 0, bad = 0;
const t = (nome, cond, info) => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && info !== undefined ? '\n       ↳ ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };
const one = (frase, titulo) => E.extract('1. ' + (titulo || 'Assunto') + '\n' + frase + '\n2. Outro assunto\nTexto.\n');
const kinds = r => ['decisoes', 'encaminhamentos', 'sugestoes', 'demandas', 'problemas'].filter(k => r[k].length);
const CONTROL = /numera[cç][aã]o|confian[cç]a|n[ií]vel|origem|gatilho/i;

const txt = fs.readFileSync(__dirname + '/atas/ata5-pdf-quebras.txt', 'utf8');
const r = E.extract(txt);

console.log('— 2. estrutura × conteúdo');
t('2a. nenhum título contém termos de controle', r.assuntos.every(a => !CONTROL.test(a)), r.assuntos);
t('2b. título quebrado em 2 linhas é preservado inteiro', r.assuntos.includes('Indicação do novo representante discente no colegiado do curso (relatoria Coordenação do curso)'), r.assuntos);
t('2c. título com parêntese fechado na linha seguinte', r.assuntos.includes('Pedido de regime excepcional de aprendizagem (relatoria prof. Rui Campos Almeida)'), r.assuntos);
t('2d. "prof." dentro do título não corta o título', r.assuntos.includes('Alterações em históricos (relatoria prof. Otávio Lins Pereira)'), r.assuntos);
t('2e. parênteses balanceados em todos os títulos', r.assuntos.every(a => (a.match(/\(/g) || []).length === (a.match(/\)/g) || []).length), r.assuntos);
t('2f. metadados ficam em propriedades separadas', r.assuntosDetalhe.every(a => typeof a.origem === 'string' && typeof a.confianca === 'number' && a.nivel && !CONTROL.test(a.titulo)));
t('2g. texto copiado da interface é limpo ("…)numeração · confiança alta")',
  one('Texto qualquer.', 'Alterações em históricos (relatoria prof. Fulano)numeração · confiança alta').assuntos[0] === 'Alterações em históricos (relatoria prof. Fulano)',
  one('Texto qualquer.', 'Alterações em históricos (relatoria prof. Fulano)numeração · confiança alta').assuntos[0]);
t('2h. título legítimo com a palavra "numeração" é mantido', one('Texto.', 'Revisão da numeração das disciplinas').assuntos[0] === 'Revisão da numeração das disciplinas');

console.log('— 3. assuntos pela estrutura');
t('3a. 5 itens da pauta = 5 assuntos', r.assuntos.length === 5, r.assuntos);
t('3b. pauta com 5 itens (continuações em maiúscula aceitas)', r.estrutura.pauta.length === 5, r.estrutura.pauta);
t('3c. sublista "1. 2. 3." dentro do item 2 NÃO vira assunto', !r.assuntos.some(a => /^Discente/.test(a)), r.assuntos);
const decHist = r.decisoes.find(d => /três solicitações/.test(d.descricao));
t('3d. texto do item 2 fica no item 2 até o início do item 3', decHist && /^Alterações em históricos/.test(decHist.assunto), decHist);
const decInd = r.decisoes.find(d => /indicação foi aprovada/.test(d.descricao));
t('3e. decisão do item 3 associada ao item 3', decInd && /^Indicação do novo representante/.test(decInd.assunto), decInd);
t('3f. sem frequência de palavras como assunto', r.assuntos.every(a => r.estrutura.pauta.includes(a)));
// mesma ata sem quebras de linha (PDF "achatado")
const flat = E.extract(txt.replace(/\n+/g, ' '));
t('3g. ata sem quebras: assuntos recuperados pela pauta', flat.assuntos.length === 5 && flat.estrutura.tipo === 'numerada', [flat.estrutura.tipo, flat.assuntos]);
const flatDec = flat.decisoes.find(d => /três solicitações/.test(d.descricao));
t('3h. ata sem quebras: decisão no assunto certo', flatDec && /^Alterações em históricos/.test(flatDec.assunto), flatDec && flatDec.assunto);
// numeração romana
const rom = E.extract('I - Informes\nA coordenadora informou que o sistema voltou.\nII - Calendário escolar\nO calendário foi aprovado por unanimidade.\nIII - Assuntos gerais\nNada a registrar.\n');
t('3i. itens em algarismos romanos', rom.assuntos.join('|') === 'Informes|Calendário escolar|Assuntos gerais', rom.assuntos);
t('3j. decisão no item romano correto', rom.decisoes[0] && rom.decisoes[0].assunto === 'Calendário escolar', rom.decisoes[0]);
// cabeçalho com título longo + corpo na mesma linha
const tb = E.extract('1. Indicação de representante para a comissão de estágio (relatoria prof. A. Lima). O relator apresentou o nome.\nTexto.\n2. Outro\nTexto.\n');
t('3k. título + corpo na mesma linha: corte após o parêntese, não em "prof."', tb.assuntos[0] === 'Indicação de representante para a comissão de estágio (relatoria prof. A. Lima)', tb.assuntos);

console.log('— 4. relato × ação');
t('4a. "relatou que recebeu um pedido…" NÃO é demanda', kinds(one('O professor relatou que recebeu um pedido de regime excepcional do discente.')).length === 0);
t('4b. "O relator solicitou a autorização…" é demanda', kinds(one('O relator solicitou a autorização para lançar o trancamento da disciplina.')).includes('demandas'));
const dReq = one('O relator solicitou a autorização para lançar o trancamento da disciplina.').demandas[0];
t('4c. demanda registra quem pediu (solicitante), não "responsável"', dReq && dReq.solicitante === 'Relator' && !dReq.responsavel, dReq);
['informou', 'explicou', 'disse', 'apresentou'].forEach(v =>
  t('4d. "' + v + ' que … precisa/pedido" sozinho NÃO gera demanda', !kinds(one('A coordenadora ' + v + ' que o curso precisa de um novo pedido de vagas.')).includes('demandas')));
t('4e. "recebeu demandas de estudantes" NÃO é demanda', !kinds(one('Informou também que recebeu demandas de estudantes sobre o horário.')).includes('demandas'));
t('4f. "apresentou três solicitações" NÃO é demanda', !kinds(one('O relator apresentou três solicitações de alteração de histórico.')).includes('demandas'));
t('4g. "É necessário ampliar…" (oração principal) é demanda', kinds(one('É necessário ampliar o número de vagas.')).includes('demandas'));
t('4h. frase nominal "Solicitação de…" continua demanda', kinds(one('Solicitação de aproveitamento de estudos.')).includes('demandas'));
t('4i. "o pedido foi feito pelo discente" NÃO é demanda nem decisão', kinds(one('O pedido foi feito pelo discente dentro do prazo.')).length === 0);
t('4j. modal dentro de relato ("disse que seria possível") NÃO é sugestão', !kinds(one('Disse que seria possível remanejar as turmas.')).includes('sugestoes'));
t('4k. "informou que enviará…" (sem sujeito próprio) continua encaminhamento', kinds(one('A coordenação informou que enviará o documento até 10/12/2099.')).includes('encaminhamentos'));
t('4l. "relatou que o aluno irá…" NÃO é encaminhamento', !kinds(one('O professor relatou que o aluno irá cursar a disciplina.')).includes('encaminhamentos'));

console.log('— 5. decisões');
t('5a. "foram aprovadas por unanimidade" é decisão', decHist && decHist.gatilho && /aprovadas/.test(decHist.gatilho) && decHist.confianca >= 0.8, decHist);
t('5b. descrição da decisão não contém metadados', r.decisoes.every(d => !CONTROL.test(d.descricao) && !/assunto:|respons[aá]vel:|prazo:/i.test(d.descricao)));
t('5c. "foi aprovado na disciplina" (resultado acadêmico) NÃO é decisão', !kinds(one('O aluno foi aprovado na disciplina de Cálculo I e pediu revisão.')).includes('decisoes'));
t('5d. "aprovada na reunião anterior" (referência) NÃO é decisão', !kinds(one('A proposta foi aprovada na reunião anterior do conselho.')).includes('decisoes'));
t('5e. decisão de outra instância dentro de relato NÃO é decisão', !kinds(one('A coordenadora informou que o pedido foi indeferido pela pró-reitoria.')).includes('decisoes'));
t('5f. "aprovado na reunião" (órgão deliberativo) continua decisão', kinds(one('O calendário foi aprovado na reunião de hoje.')).includes('decisoes'));
t('5g. "deliberou-se" é decisão', kinds(one('Deliberou-se pela manutenção da oferta.')).includes('decisoes'));
t('5h. "foi indeferido" é decisão', kinds(one('O recurso foi indeferido por maioria.')).includes('decisoes'));

console.log('— 6. responsáveis');
t('6a. "pelo discente" (passiva no passado) NÃO é responsável', !(one('O pedido feito pelo discente foi aprovado por unanimidade.').decisoes[0] || {}).responsavel);
t('6b. "aprovada pelo colegiado" NÃO vira responsável da decisão', !(one('A alteração foi aprovada pelo colegiado.').decisoes[0] || {}).responsavel);
const e6 = one('O discente deverá entregar o documento até 10/12/2099.').encaminhamentos[0];
t('6c. papel genérico com obrigação explícita ("deverá") é responsável', e6 && e6.responsavel === 'Discente' && e6.responsaveis[0].tipo === 'papel', e6);
t('6d. papel genérico sem ação operacional atribuída NÃO é responsável', !(one('Os alunos irão cursar a disciplina no próximo semestre.').encaminhamentos[0] || {}).responsavel);
const e6b = one('A comunicação ao aluno será feita pela coordenação.').encaminhamentos[0];
t('6e. órgão como agente de passiva FUTURA é responsável (tipo órgão)', e6b && e6b.responsavel === 'Coordenação' && e6b.responsaveis[0].tipo === 'orgao', e6b);
const e6c = one('Prof. Marcos Teles ficou responsável por elaborar o parecer.').encaminhamentos[0];
t('6f. pessoa identificada (tipo pessoa)', e6c && e6c.responsaveis[0].tipo === 'pessoa' && /Marcos Teles/.test(e6c.responsavel), e6c);
const e6d = one('A Comissão de Estágio deverá revisar o regulamento.').encaminhamentos[0];
t('6g. "Comissão de Estágio" é órgão (não pessoa "Estágio")', e6d && e6d.responsavel === 'Comissão de Estágio' && e6d.responsaveis[0].tipo === 'orgao', e6d);
t('6h. passiva passada com papel genérico ("encaminhado … pelo discente") sem responsável', !(one('O processo foi encaminhado à pró-reitoria pelo discente.').encaminhamentos[0] || {}).responsavel);

console.log('— 7. prazos × contexto');
const H = 'Ata da reunião realizada aos 14 dias do mês de março de 2025.\n';
const pz = f => { const x = E.extract(H + '1. Assunto\n' + f + '\n2. Outro\nTexto.\n'); return [].concat(x.decisoes, x.encaminhamentos)[0] || {}; };
t('7a. "currículo 2023.2" NÃO é prazo', !pz('Foi aprovada a alteração do histórico do aluno do currículo 2023.2.').prazo);
const c7 = pz('Foram aprovadas as alterações das disciplinas cursadas em 2024.1.');
t('7b. semestre passado ("cursadas em 2024.1") é contexto, não prazo', !c7.prazo && (c7.referencias || []).some(x => x.papel === 'contexto'), c7);
t('7c. "até o final do período letivo de 2025.1" é prazo da decisão', /até o final do período letivo de 2025\.1/.test(pz('Foi aprovado o regime excepcional até o final do período letivo de 2025.1.').prazo || ''));
t('7d. "na próxima reunião" é prazo', pz('O tema será retomado na próxima reunião.').prazo === 'na próxima reunião');
t('7e. "antes do encerramento do semestre" é prazo', /antes do encerramento/.test(pz('A secretaria enviará o cronograma antes do encerramento do semestre.').prazo || ''));
t('7f. "ingressou em 2025.1" (contexto) NÃO é prazo', !pz('Foi aprovado o pedido do aluno que ingressou em 2025.1.').prazo);
t('7g. "deverá ocorrer em 2025.2" é prazo', /2025\.2/.test(pz('Ficou decidido que a defesa deverá ocorrer em 2025.2.').prazo || ''));
t('7h. "durante o semestre 2025.2" em decisão (vigência) é prazo', /2025\.2/.test(pz('Foi aprovada a oferta durante o semestre 2025.2.').prazo || ''));
const enc5 = r.encaminhamentos.find(e => /plano de estudos/.test(e.descricao));
t('7i. na ata: "até 30/04/2025" é prazo do encaminhamento', enc5 && enc5.prazo === 'até 30/04/2025', enc5);
t('7j. na ata: nenhum prazo com período passado ou curricular', ![].concat(r.decisoes, r.encaminhamentos).some(x => /2023\.2|2024\.1/.test(x.prazo || '')));

console.log('— 8. outros formatos (ata6: "Ordem do dia" + "Item N –", outro tipo de órgão)');
const t6 = fs.readFileSync(__dirname + '/atas/ata6-item-ordem-do-dia.txt', 'utf8');
for (const [lab, src] of [['com quebras', t6], ['sem quebras', t6.replace(/\n+/g, ' ')]]) {
  const r6 = E.extract(src);
  t('8a. [' + lab + '] pauta "Item N –" com 3 itens', r6.estrutura.pauta.length === 3, r6.estrutura.pauta);
  t('8b. [' + lab + '] título quebrado em minúscula é unido', r6.assuntos[0] === 'Homologação do resultado do concurso para professor substituto de Língua Espanhola', r6.assuntos);
  t('8c. [' + lab + '] título com ano na linha seguinte ("para\\n2027")', r6.assuntos[2] === 'Plano de capacitação docente para 2027', r6.assuntos);
  const ind = r6.decisoes.find(d => /indeferido/.test(d.descricao));
  t('8d. [' + lab + '] decisão no item 2', ind && /^Recurso administrativo/.test(ind.assunto), ind && ind.assunto);
  t('8e. [' + lab + '] "cursou a disciplina em 2025.2" não é prazo', ![].concat(r6.decisoes, r6.encaminhamentos).some(x => /2025\.2/.test(x.prazo || '')));
  t('8f. [' + lab + '] "pedido foi recebido pela secretaria" (relato) não gera item', ![].concat(r6.decisoes, r6.encaminhamentos, r6.demandas).some(x => /recebido pela secretaria/.test(x.descricao)));
  const com = r6.encaminhamentos.find(e => /será comunicado/.test(e.descricao));
  t('8g. [' + lab + '] passiva futura "pela chefia" → responsável órgão', com && com.responsavel === 'Chefia' && com.responsaveis[0].tipo === 'orgao', com);
  const doc = r6.encaminhamentos.find(e => /docentes interessados/.test(e.descricao));
  t('8h. [' + lab + '] "Os docentes interessados deverão…" → papel com obrigação', doc && doc.responsavel === 'Docentes', doc && doc.responsavel);
}
console.log('— 9. continuação de título não engole o corpo');
t('9a. "Turma A" é título completo', JSON.stringify(E.extract('1. Oferta da Turma A\nOs docentes deverão enviar as notas.\n2. Outro\nTexto.').assuntos) === '["Oferta da Turma A","Outro"]');
t('9b. "do\\nProf. Fulano" é unido', E.extract('1. Pedido de afastamento do\nProf. Rui Lima\nO pedido foi aprovado.\n2. Outro\nTexto.').assuntos[0] === 'Pedido de afastamento do Prof. Rui Lima');
t('9c. linha seguinte que é frase completa não entra no título', E.extract('1. Calendário de\nO calendário foi aprovado por unanimidade.\n2. Outro\nTexto.').decisoes.length === 1);

console.log('— 10. texto da ata para leitura (toReadable)');
const rd = E.toReadable(txt);
const tipos = rd.map(n => n.tipo);
t('10a. cabeçalho do documento reconhecido', rd[0].tipo === 'titulo' && /UNIVERSIDADE/.test(rd[0].texto));
t('10b. linha de prosa quebrada pelo PDF NÃO vira título', !rd.some(n => n.tipo === 'titulo' && /^Aos 14 dias/.test(n.texto)));
t('10c. parágrafo quebrado em 2 linhas é reunido', rd.some(n => n.tipo === 'paragrafo' && /os membros do Colegiado\.$/.test(n.texto)));
t('10d. pauta vira um bloco com 5 itens', rd.filter(n => n.tipo === 'pauta').length === 1 && rd.find(n => n.tipo === 'pauta').itens.length === 5);
t('10e. 5 seções com o título completo', rd.filter(n => n.tipo === 'secao').length === 5 && rd.some(n => n.tipo === 'secao' && /\(relatoria Coordenação do curso\)$/.test(n.titulo)));
t('10f. sublista numerada vira itens de lista', rd.filter(n => n.tipo === 'item').length === 3);
t('10g. assinatura separada do texto', tipos[tipos.length - 1] === 'assinatura');
t('10h. nenhuma palavra do texto é perdida', (() => { const w = s => (s.match(/[A-Za-zÀ-ú]{4,}/g) || []).length; const all = rd.map(n => [n.texto, n.titulo, (n.itens || []).map(i => i.titulo).join(' '), (n.linhas || []).flat().join(' ')].join(' ')).join(' '); return w(all) >= w(txt) * 0.97; })());
const rdFlat = E.toReadable(txt.replace(/\n+/g, ' '));
t('10i. ata sem quebras: seções recuperadas e parágrafos ≤ ~900 caracteres', rdFlat.filter(n => n.tipo === 'secao').length === 5 && rdFlat.filter(n => n.tipo === 'paragrafo').every(n => n.texto.length <= 1100));
const rdTab = E.toReadable(fs.readFileSync(__dirname + '/atas/ata3-titulos-tabela.txt', 'utf8'));
t('10j. tabela preservada como tabela', rdTab.some(n => n.tipo === 'tabela' && n.linhas.length >= 3 && n.linhas[0].length === 3));
t('10k. entrada vazia → lista vazia', E.toReadable('').length === 0);

console.log('— 11. item 17 · ata real (ata7) + ata fictícia de 2 páginas de outra instituição (ata8)');
const t7 = fs.readFileSync(__dirname + '/atas/ata7-pdf-real-cabecalhos.txt', 'utf8');
const t8 = fs.readFileSync(__dirname + '/atas/ata8-duas-paginas-outra-instituicao.txt', 'utf8');
const r7 = E.extract(t7), r8 = E.extract(t8);
const all7 = [].concat(r7.decisoes, r7.encaminhamentos, r7.demandas, r7.problemas, r7.sugestoes);
const all8 = [].concat(r8.decisoes, r8.encaminhamentos, r8.demandas, r8.problemas, r8.sugestoes);
// 1–3: assuntos
t('17.1 assuntos sem "numeração"', [].concat(r7.assuntos, r8.assuntos).every(a => !/numera/i.test(a)));
t('17.2 assuntos sem "confiança"', [].concat(r7.assuntos, r8.assuntos).every(a => !/confian/i.test(a)));
t('17.3 títulos inteiros (parênteses fechados, sem rodapé)', r7.assuntos.includes('Inclusão de disciplina no histórico do discente Bafesa Bafira Bafilo (20220000099)') && r8.assuntos.join('|') === 'Calendário de formaturas|Solicitação de compra de equipamentos', [r7.assuntos, r8.assuntos]);
t('17.3b subtítulos a)/b)/c) reconhecidos dentro do item', JSON.stringify((r7.assuntosDetalhe[0] || {}).subtopicos) === '["Secretaria unificada","Programa de Acompanhamento Acadêmico","Relatório CIAC (prof. Badoto)"]');
// 4–5: prazos
t('17.4 "2026.1"/"2026.2" de contexto não viram prazo', !all7.some(x => /2026\.[12]/.test(x.prazo || '')), all7.map(x => x.prazo));
t('17.4b … ficam como referência de contexto', r7.decisoes[0] && (r7.decisoes[0].referencias || []).some(x => x.papel === 'contexto'));
t('17.5 prazo relacional associado à ação', r8.encaminhamentos.some(e => e.prazo === 'até 30/06/2025') && r7.encaminhamentos.some(e => e.prazo === 'nas próximas reuniões do Colegiado do BSI'));
// 6: responsáveis
t('17.6 "Discente" não aparece como responsável', !all7.concat(all8).some(x => /^discente/i.test(x.responsavel || '')));
t('17.6b órgão com obrigação explícita é responsável', r8.encaminhamentos.some(e => /setor de compras/i.test(e.responsavel || '')), r8.encaminhamentos.map(e => e.responsavel));
// 7: relato × demanda
t('17.7 "relatou que recebeu um pedido" não é demanda', !r8.demandas.some(d => /recebeu um pedido/.test(d.descricao)));
t('17.7b "solicitou que …" é demanda', r8.demandas.some(d => /solicitou que o setor/.test(d.descricao)));
t('17.7c "está sendo solicitado ao Colegiado…" é demanda (ata real)', r7.demandas.some(d => /está sendo solicitado/.test(d.descricao)));
t('17.7d relato de decisão de outro órgão (CONSEPE) não é decisão', !r7.decisoes.some(d => /CONSEPE/.test(d.descricao)));
// 8: sugestão × decisão posterior
t('17.8 sugestão NÃO vira deliberada por decisão diferente no mesmo bloco', r8.sugestoes.some(sg => /sugeriu incluir o grupo/.test(sg.descricao) && sg.situacao === 'pendente'), JSON.stringify([r8.sugestoes, r8.sugestoesDeliberadas]));
t('17.8b sugestão com referência explícita é deliberada', E.extract('1. Horário\nO prof. A sugeriu mudar o horário das reuniões. A sugestão foi aprovada por unanimidade.\n2. Outro\nTexto.').sugestoesDeliberadas.length === 1);
// 9: decisão no assunto certo
t('17.9 decisão da ata real no assunto certo, com confiança alta', r7.decisoes.length === 1 && /^Inclusão de disciplina/.test(r7.decisoes[0].assunto) && r7.decisoes[0].confianca >= 0.8);
t('17.9b decisão que atravessa a quebra de página fica inteira e no assunto I', r8.decisoes.some(d => /foi aprovada por unanimidade\.$/.test(d.descricao) && d.assunto === 'Calendário de formaturas'), r8.decisoes.map(d => [d.descricao, d.assunto]));
t('17.9c evento do bloco 3 fica no 3 mesmo citando palavras do assunto 1',
  E.extract('1. Calendário acadêmico\nTexto.\n2. Laboratórios\nTexto.\n3. Bolsas de monitoria\nO calendário acadêmico das bolsas de monitoria foi aprovado por unanimidade.\n').decisoes[0].assunto === 'Bolsas de monitoria');
// 10: problemas são obstáculos
t('17.10 "não há como realizar… interditado" é problema', r8.problemas.some(p => /Não há como realizar/.test(p.descricao)));
t('17.10b preocupação com perda de espaço é problema (ata real)', r7.problemas.some(p => /preocupação com a perda/.test(p.descricao)));
['O afastamento não prejudica a oferta.', 'Não houve atrasos na entrega.', 'Houve uma palestra sobre evasão escolar.', 'Não há como negar a importância do tema.']
  .forEach(f => t('17.10c "' + f + '" NÃO é problema', one(f).problemas.length === 0, one(f).problemas));
// 11: deduplicação
t('17.11 frase idêntica em dois assuntos = dois eventos', E.extract('1. Calendário\nO pedido foi deferido pelo colegiado.\n2. Afastamento\nO pedido foi deferido pelo colegiado.\n3. Outro\nTexto.').decisoes.length === 2);
t('17.11b "deferido" × "indeferido" nunca se fundem', E.extract('1. Recursos\nO recurso do aluno A foi deferido por unanimidade. O recurso do aluno A foi indeferido por unanimidade.\n2. Outro\nTexto.').decisoes.length === 2);
t('17.11c sugestão e decisão de mesma frase não se fundem', (() => { const x = E.extract('1. A\nFoi proposta e aprovada a criação da comissão de estágio.\n2. B\nTexto.'); return x.decisoes.length === 1; })());
// 12: texto original íntegro
const copy7 = t7.slice();
E.extract(t7); E.toReadable(t7);
t('17.12 a análise não altera o texto original', t7 === copy7);
const rd7 = E.toReadable(t7);
const words = x => (x.match(/[A-Za-zÀ-ú]{4,}/g) || []);
const body7 = E.normalizeText(t7);
const rdText = rd7.map(n => [n.texto, n.titulo, n.rotulo, n.valor, (n.itens || []).map(i => i.titulo).join(' '), (n.linhas || []).join(' '), (n.registros || []).map(r => r.nome + ' ' + r.status).join(' ')].join(' ')).join(' ');
t('17.12b leitura formatada não perde palavras do texto (sem cabeçalho/rodapé)', words(rdText).length >= words(body7).length * 0.97, [words(rdText).length, words(body7).length]);
t('17.12c cabeçalho/rodapé repetidos removidos da análise e da leitura', (E.normalizeText(t7).match(/UNIVERSIDADE/g) || []).length === 1 && !/Página \d de 5|do Colegiado do BSI – 26 de agosto/.test(E.normalizeText(t7)));
t('17.12d … também numa ata de 2 páginas (zona de página, sem regra de nome)', (E.normalizeText(t8).match(/INSTITUTO FEDERAL/g) || []).length === 1 && !/página \d/.test(E.normalizeText(t8)));
t('17.12e parágrafo que atravessa a página é reunido na leitura', E.toReadable(t8).some(n => n.tipo === 'paragrafo' && /aprovada por unanimidade\./.test(n.texto) && /indicação da servidora/.test(n.texto)));
t('17.12f ordinal sobrescrito reconstruído ("profª Baberi")', /profª Baberi/.test(E.normalizeText(t7)) && !E.extract(t7).termosRecorrentes.some(x => /baberi/i.test(x.termo)));
t('17.12g lista de presença com status → 16 presentes, 8 ausentes, 8 justificadas', r7.presenca && r7.presenca.presentes.length === 16 && r7.presenca.ausentes.length === 8 && r7.presenca.justificadas.length === 8 && r7.participantes.length === 16);
// 13: formatos diferentes
const fmts = fs.readdirSync(__dirname + '/atas').filter(f => /\.txt$/.test(f));
fmts.forEach(f => {
  const src = fs.readFileSync(__dirname + '/atas/' + f, 'utf8');
  let ok13 = true, info;
  try {
    for (const variant of [src, src.replace(/\n+/g, ' ')]) {
      const x = E.extract(variant);
      if (x.assuntos.some(a => /numera|confian/i.test(a))) { ok13 = false; info = x.assuntos; }
      if (!E.toReadable(variant).length) { ok13 = false; info = 'leitura vazia'; }
    }
  } catch (e) { ok13 = false; info = e.message; }
  t('17.13 ' + f + ' (com e sem quebras) processa sem erro', ok13, info);
});

console.log('\n' + ok + ' ok / ' + bad + ' falhas');
process.exitCode = bad ? 1 : 0;
