// ENTRADA: upload → texto → data e reunião. Tudo no navegador (GitHub Pages).
// Sem dependências: o layout do PDF e o texto de OCR vêm de fixtures (gerados por js/pdftext.js).
const fs = require('fs'), E = require('../js/extractor.js');
let ok = 0, bad = 0;
const t = (nome, cond, info) => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FAIL ') + nome + (!cond && info !== undefined ? '\n       ↳ ' + JSON.stringify(info) : '')); };

console.log('— data da reunião no texto');
[['Aos 14 dias do mês de março de 2025, às 10h, reuniram-se os membros.', '2025-03-14'],
 ['Aos dois dias de junho de 2025, reuniram-se. O prazo é até 30/06/2025.', '2025-06-02'],
 ['Aos vinte e seis dias do mês de agosto do ano de dois mil e vinte e seis, reuniram-se os membros.', '2026-08-26'],
 ['Ao primeiro dia de março de 2024, às 10h, reuniram-se.', '2024-03-01'],
 ['Aos trinta e um dias de dezembro de dois mil e dezenove, reuniram-se.', '2019-12-31'],
 ['Conforme Resolução de 12/03/2019, os membros reuniram-se no dia 05/04/2026 às 14h.', '2026-04-05'],
 ['Nos termos da Portaria nº 12 de 03/02/2020, a reunião ocorreu em 10/03/2026.', '2026-03-10'],
 ['ATA\n10/02/2026\nOs membros deverão entregar até 20/02/2026.', '2026-02-10'],
 ['Os documentos devem ser entregues até 15/05/2026. A reunião foi realizada em 02/05/2026.', '2026-05-02'],
 ['Texto sem nenhuma data.', null]
].forEach(([txt, exp]) => t('data: ' + JSON.stringify(txt.slice(0, 60)) + ' → ' + exp, E.findMeetingDate(txt) === exp, E.findMeetingDate(txt)));
t('"dois mil e vinte e cinco" = 2025, "trinta e um" = 31 (via extração)', E.findMeetingDate('Aos trinta e um dias de março de dois mil e vinte e cinco, reuniram-se.') === '2025-03-31');

console.log('— nome do ficheiro como último recurso');
const M = E.metaFromFilename;
[['Ata - 1ª Reunião Ordinária - 2026-08-26.pdf', '2026-08-26', '1ª Reunião Ordinária'],
 ['ata_12-03-2026.txt', '2026-03-12', null],
 ['ATA 5 de junho de 2026.pdf', '2026-06-05', null],
 ['ata 20260826.pdf', '2026-08-26', null],
 ['Reunião Extraordinária nº 3 - 2025.2.pdf', null, 'Reunião Extraordinária nº 3 2025.2'],
 ['qualquer-coisa.pdf', null, null]
].forEach(([f, d, r]) => { const x = M(f); t('nome "' + f + '" → data ' + d + ', reunião ' + r, x.data === d && x.reuniao === r, x); });
t('duas datas diferentes no nome → ambíguo, nenhuma é usada', M('ata 2026-01-10 e 2026-02-10.pdf').data === null && M('ata 2026-01-10 e 2026-02-10.pdf').ambigua);
t('matrícula de 11 dígitos no nome NÃO vira data', M('pedido 20222210033.pdf').data === null);
const semData = E.extract('Ata da reunião do colegiado.\n1. Assunto\nTexto qualquer aqui.\n2. Outro\nMais texto.', { filename: 'Ata - 3ª Reunião Ordinária - 2025-04-10.pdf' });
t('sem data no texto → usa o nome do ficheiro e marca a origem', semData.data === '2025-04-10' && semData.dataOrigem === 'nome do ficheiro', [semData.data, semData.dataOrigem]);
t('título genérico no texto → reunião do nome do ficheiro, com aviso', semData.reuniao === '3ª Reunião Ordinária' && semData.reuniaoOrigem === 'nome do ficheiro' && semData.avisos.some(a => /genérica/.test(a)), [semData.reuniao, semData.avisos]);
const comData = E.extract('Aos 14 dias do mês de março de 2025, reuniram-se os membros.\n1. Assunto\nTexto.\n2. Outro\nTexto.', { filename: 'ata 2025-03-15.pdf' });
t('data no texto TEM prioridade sobre o nome do ficheiro', comData.data === '2025-03-14' && comData.dataOrigem === 'texto');
t('… e a divergência vira aviso', (comData.avisos || []).some(a => /diferente da data no nome do ficheiro/.test(a)), comData.avisos);
const r8 = E.extract(fs.readFileSync(__dirname + '/atas/ata8-duas-paginas-outra-instituicao.txt', 'utf8'));
t('ata8: data da reunião é a do "Aos dois dias…", não o prazo 30/06/2025 (erro antigo)', r8.data === '2025-06-02', r8.data);

console.log('— layout do PDF (negrito, fonte maior, itálico)');
const t5 = fs.readFileSync(__dirname + '/atas/ata5-pdf-quebras.txt', 'utf8');
const plain = 'Aos 3 dias de maio de 2025, reuniram-se os associados na sede da associação, sob a presidência do Sr. Caio Lemos.\nReforma da quadra\nO tesoureiro apresentou três orçamentos para a reforma da quadra.\nO orçamento da empresa Alfa foi aprovado por maioria, com dois votos contrários.\nSegurança no bairro\nFoi relatada dificuldade de contato com a guarda municipal nos fins de semana.\n';
const layout = { destaques: [{ texto: 'Reforma da quadra', motivo: 'negrito' }, { texto: 'Segurança no bairro', motivo: 'negrito' }], enfase: ['O orçamento da empresa Alfa foi aprovado por maioria, com dois votos contrários.'] };
const sem = E.extract(plain), com = E.extract(plain, { layout });
t('títulos em negrito viram estrutura "título em destaque"', com.estrutura.tipo === 'titulos' && com.assuntosDetalhe.every(a => /destaque/.test(a.origem)), com.assuntosDetalhe.map(a => a.origem));
t('… com confiança de estrutura maior que sem layout', com.assuntosDetalhe[0].confianca > (sem.assuntosDetalhe[0] || { confianca: 0 }).confianca, [com.assuntosDetalhe[0].confianca, (sem.assuntosDetalhe[0] || {}).confianca]);
const dCom = com.decisoes[0], dSem = sem.decisoes[0];
t('deliberação em itálico ganha a evidência "trecho destacado"', dCom && dCom.evidencias.some(e => /destacado na formatação/.test(e.texto)) && !(dSem.evidencias || []).some(e => /destacado/.test(e.texto)));
t('… mas a formatação sozinha não cria decisões', E.extract('1. A\nTexto comum de relato.\n2. B\nOutro.', { layout: { destaques: [], enfase: ['Texto comum de relato.'] } }).decisoes.length === 0);
t('layout não muda a extração quando não traz destaques (ata5 idêntica)', JSON.stringify(E.extract(t5).decisoes) === JSON.stringify(E.extract(t5, { layout: { destaques: [], enfase: [] } }).decisoes));
t('linha em negrito com URL ou lista não vira título', !E.extract(plain + 'https://exemplo.org/doc\n', { layout: { destaques: layout.destaques.concat([{ texto: 'https://exemplo.org/doc', motivo: 'negrito' }]) } }).assuntos.some(a => /https/.test(a)));

console.log('— texto obtido por OCR (ata9, fictícia, digitalizada)');
const ocrTxt = fs.readFileSync(__dirname + '/atas/ata9-digitalizada.ocr.txt', 'utf8');
const r9 = E.extract(ocrTxt, { filename: 'ata9-digitalizada.pdf', ocr: [{ pagina: 1, confianca: 95 }, { pagina: 2, confianca: 95 }] });
t('romanos lidos com erro de OCR ("1I –") reconhecidos como item II', JSON.stringify(r9.assuntos) === '["Calendário de formaturas","Solicitação de compra de equipamentos"]', r9.assuntos);
t('data por extenso reconhecida no texto do OCR', r9.data === '2025-06-02');
t('cabeçalho/rodapé repetidos removidos também no OCR', !/Conselho do Campus\s*[-–]\s*página/.test(E.normalizeText(ocrTxt)));
t('itens de texto OCR explicam a confiança reduzida', r9.decisoes.concat(r9.encaminhamentos).every(x => x.evidencias.some(e => /OCR/.test(e.texto))));
t('análise avisa que houve OCR', (r9.avisos || []).some(a => /OCR/.test(a)));
const noOcr = E.extract(ocrTxt);
t('OCR reduz a confiança em relação ao mesmo texto digital', r9.decisoes[0].confianca < noOcr.decisoes[0].confianca, [r9.decisoes[0].confianca, noOcr.decisoes[0].confianca]);
t('"1 - Título" continua sendo item numerado comum (sem falso romano)', E.extract('1 - Primeiro\nTexto.\n2 - Segundo\nTexto.').assuntos.join('|') === 'Primeiro|Segundo');

console.log('— identificação da reunião (outros órgãos e formatos)');
[['Ata da 5ª Reunião Ordinária do Colegiado do Curso de Pedagogia\nAos 12 dias…', '5ª Reunião Ordinária — Colegiado do Curso de Pedagogia'],
 ['Ata da 112ª Reunião Extraordinária do Conselho do Departamento de Letras\nRealizada em…', '112ª Reunião Extraordinária — Conselho do Departamento de Letras'],
 ['Ata da 3ª Sessão Ordinária da Congregação do Instituto de Física\nAos 3 dias…', '3ª Sessão Ordinária — Congregação do Instituto de Física'],
 ['Ata da Assembleia Geral Extraordinária da Associação de Moradores realizada aos 3 dias\nTexto', 'Assembleia Geral Extraordinária — Associação de Moradores'],
 ['Ata da 4ª Reunião Ordinária do Conselho Superior, realizada em 10/03/2026', '4ª Reunião Ordinária — Conselho Superior'],
 ['CÂMARA DE GRADUAÇÃO\nAta nº 12/2024\nAos 3 dias de maio…', 'Ata nº 12/2024 — CÂMARA DE GRADUAÇÃO'],
 ['INSTITUTO X\nConselho do Campus Sul\nAta nº 4/2025 do Conselho do Campus\nAos dois dias…', 'Ata nº 4/2025 — Conselho do Campus Sul']
].forEach(([txt, exp]) => t('reunião: ' + JSON.stringify(txt.split('\n')[0].slice(0, 60)) + ' → ' + exp, E.findReuniao(txt) === exp, E.findReuniao(txt)));
t('o nome do órgão não invade a linha seguinte', !/Aos|Realizada/.test(E.findReuniao('Ata da 3ª Sessão Ordinária da Congregação do Instituto de Física\nAos 3 dias…')));

console.log('\n' + ok + ' ok / ' + bad + ' falhas');
process.exitCode = bad ? 1 : 0;
