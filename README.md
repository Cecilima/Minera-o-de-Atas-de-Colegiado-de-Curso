# Arquivo de Atas — Colegiado

Sistema estático (HTML/CSS/JS puro, sem backend) para enviar atas de
reunião em PDF/TXT, extrair automaticamente assuntos, decisões,
encaminhamentos, responsáveis, prazos e termos recorrentes, e explorar
tudo isso por um painel visual, uma aba de responsáveis e uma busca por
palavras-chave.

## Estrutura

```
index.html       → marcação da página (4 abas: Arquivo, Painel, Responsáveis, Consulta)
css/styles.css   → todo o estilo visual (tema único, claro)
js/extractor.js  → motor de extração das atas (puro, sem DOM; roda no navegador e no Node)
js/pdftext.js    → leitura de PDF no navegador: texto, layout (negrito/fonte/parágrafos) e OCR (Tesseract.js)
js/app.js        → interface: upload, tabela, gaveta de detalhes, gráficos, busca, consulta
tests/           → testes (node tests/frases.js · regressao.js · generalizacao.js · confianca.js · compatibilidade.js · entrada.js;
                   PDFJS=…/pdf.mjs node tests/pdf.mjs; browser-*.js usam Playwright)
                   ata7 = texto real de PDF com nomes anonimizados; browser-pdf.js envia um PDF pela interface
README.md        → este arquivo
```

## Como funciona (importante)

Esta versão foi preparada para rodar como **página estática no GitHub
Pages**, ou seja, sem nenhum servidor por trás. Por isso:

- **Extração de texto**: PDFs são lidos no navegador com `pdf.js`; TXT é
  lido diretamente.
- **Análise**: feita no próprio navegador por `js/extractor.js`, sem IA externa.
  Em vez de procurar palavras soltas, o extrator segue este pipeline:
  1. normaliza o texto (preservando quebras de linha, removendo números de página e rodapés repetidos);
  2. identifica a estrutura da ata — pauta, itens numerados ("1.", "Item 2"), títulos em maiúsculas,
     títulos com dois-pontos ou texto corrido — e divide em blocos;
  3. **assuntos** vêm só de evidência estrutural (pauta, cabeçalhos, frases como "tratou-se de…").
     Se não houver evidência, o assunto fica *não identificado* — nunca é inventado a partir de palavras frequentes;
  4. dentro de cada bloco, cada sentença é pontuada por **padrões linguísticos** para
     decisão, encaminhamento, problema, demanda e sugestão/proposta (ver abaixo);
  5. para cada encaminhamento relaciona **ação + responsável + prazo/referência temporal**;
  6. **termos recorrentes** são calculados à parte, independentes dos assuntos;
  7. remove duplicidades e atribui um nível de **confiança** (alta/média/baixa) a cada item.
- **Decisão × sugestão × encaminhamento**: "foi aprovado…", "ficou definido que…", "deliberou-se…",
  "o colegiado decidiu…" e resultados de votação são decisões. "Sugeriu que fosse aprovada", "seria
  interessante…", "caso seja aprovado…", "conforme aprovado na reunião anterior" e alunos "aprovados" **não** são.
  Encaminhamento é detectado por estrutura (ex.: "X ficará responsável por…", "deverá…", "irá…",
  "será realizada…", "se comprometeu a…"), sem depender da palavra "encaminhamento".
- **Estrutura × conteúdo**: o título de um assunto é só texto da ata. Origem, confiança e nível ficam em
  propriedades separadas (`origem`, `confianca`, `nivel`) e, na interface, são desenhados por CSS — copiar
  a lista de assuntos nunca leva "numeração · confiança" junto. Títulos quebrados pelo PDF (parêntese aberto,
  final em preposição/artigo, continuação em minúscula) são reunidos. Sublistas numeradas dentro de um item
  não viram assuntos, porque a sequência de itens é escolhida como cadeia (1→2→3…) conferida com a pauta. Itens
  em algarismos romanos e no formato "Item N –" são aceitos. Numa ata sem quebras de linha, o corpo é
  segmentado pelos itens da pauta.
- **Relato × ação**: o que vem depois de "relatou/informou/explicou/disse/apresentou… que" é contexto.
  Uma palavra como "pedido", "precisa" ou "solicitou" dentro do relato não gera demanda, decisão nem
  encaminhamento. O ato precisa estar na oração principal ("O relator solicitou…").
- **Responsáveis**: cada entidade tem `tipo` (`pessoa`, `orgao`, `cargo`, `papel`). Um papel genérico
  (discente, professor, aluno, membros) só é responsável com ação explicitamente atribuída ("deverá",
  "ficará responsável", "cabe ao"). O agente da passiva no passado ("o pedido foi feito pelo discente",
  "aprovado pelo colegiado") não é responsável. Quem pediu fica em `solicitante`.
- **Cabeçalhos e rodapés**: reconhecidos pela POSIÇÃO (linha que se repete no topo/pé de metade das páginas) ou
  por repetição com números normalizados ("Página 1 de 5" ≈ "Página 2 de 5") — nunca por nome de instituição.
  O cabeçalho institucional fica uma vez, no topo; a fronteira de página não quebra parágrafos.
- **Sugestão deliberada** só com evidência: a decisão se refere à proposta ("a sugestão foi aprovada") ou repete
  o seu conteúdo. Estar no mesmo assunto não basta. **Deduplicação** só dentro do mesmo bloco/subtítulo e da mesma
  lista, nunca entre "deferido" e "indeferido", preservando os metadados.
- **Texto original**: guardado intacto, separado da análise; o leitor alterna entre "Formatado" e "Original".
- **Nível de confiança** (alta · média · baixa): mede só a **segurança da classificação automática**, nunca a
  importância do item nem a confiabilidade da ata. É calculado em `calibrateConfidence()` a partir da força do
  gatilho textual, da estrutura (bloco de item da pauta, rótulo, tabela), do contexto (relato, hipótese, condição),
  da relação com o assunto do bloco e da consistência entre evidências. Cada item guarda `nivel` e `evidencias`
  (o porquê da nota). Abaixo de 0,5 o trecho não é classificado. Na interface, clique no nível para ver as
  evidências e abrir o trecho na ata. A explicação geral está no "?" do cabeçalho.
- **Entrada (tudo no navegador, compatível com GitHub Pages)**: PDF ou TXT, vários de uma vez. A leitura de PDF
  (`js/pdftext.js`) reconstrói as linhas pela posição, marca **parágrafos reais** pelo espaçamento vertical e
  registra pistas de **layout**: linhas curtas em negrito ou com fonte maior (prováveis títulos) e trechos do corpo
  inteiramente em negrito/itálico (deliberações destacadas). Essas pistas reforçam a estrutura e a confiança, mas
  nunca criam itens sozinhas. **PDF digitalizado**: as páginas sem texto passam por OCR com **Tesseract.js**
  (português), carregado sob demanda da CDN só quando necessário. O texto vindo do OCR é marcado e reduz um pouco a
  confiança. Se o OCR não puder ser carregado (sem internet), o sistema avisa.
- **Data e reunião**: data numérica ou por extenso ("aos vinte e seis dias do mês de agosto do ano de dois mil e
  vinte e seis"). Entre as datas do início da ata, vale a que tem contexto de reunião ("aos… dias", "no dia",
  "realizada em"), e não um prazo ou a data de um documento citado. A reunião é identificada por tipo de sessão +
  órgão (colegiado, conselho, comissão, congregação, assembleia, câmara…) ou por "Ata nº X/AAAA". O **nome do
  ficheiro** é usado só como último recurso, com a origem marcada ("data obtida do nome do ficheiro"). Se o texto e
  o nome do ficheiro divergem, a análise avisa.
- **Prazos e referências temporais**: datas absolutas, períodos ("2026.2", "no próximo semestre"),
  datas relativas ("nas próximas semanas"), eventos ("antes da prova"), reuniões ("na próxima reunião")
  e expressões vagas ("o quanto antes"). Cada referência tem um papel: **prazo** (marcador relacional como "até", "antes de",
  "no prazo de", reunião futura, oração no futuro/obrigação, vigência de decisão) ou **contexto** ("currículo
  2023.2", "cursada em 2024.1", períodos anteriores à reunião). Só o prazo preenche `prazo`; o contexto vai para
  `referencias` com `papel: "contexto"`. Referências relativas são preservadas como no texto; quando há
  uma data ligada ao evento ("antes da prova, marcada para 29/11/2026") ela vem como *data associada*.
- **Persistência**: os dados ficam salvos no `localStorage` do navegador
  de quem está usando a página. Ou seja, cada pessoa que abre a página
  vê apenas as atas que ela mesma enviou naquele navegador — nada é
  compartilhado entre visitantes nem enviado a um servidor. Limpar os
  dados do site no navegador apaga o histórico.
- **Aba Consulta**: como não há IA por trás, as perguntas são respondidas
  por uma busca local por palavras-chave nas decisões, encaminhamentos e
  problemas identificados — não é um resumo gerado por um modelo de
  linguagem.

Se no futuro você quiser uma análise mais rica (com um modelo de
linguagem de verdade), será necessário acrescentar um backend próprio
(por exemplo, uma função serverless que chame a API da Anthropic com uma
chave protegida) e adaptar `analyzeText()` e `answerLocally()` em
`js/app.js` (ou substituir `AtaExtractor.extract()`) para chamar esse backend em vez da lógica local.

## Publicando no GitHub Pages

1. Crie um repositório novo no GitHub (pode ser público ou privado, mas
   o GitHub Pages gratuito exige repositório público, a menos que você
   tenha GitHub Pro/Team/Enterprise).
2. Envie estes arquivos (`index.html`, a pasta `css/` e a pasta
   `js/`; a pasta `tests/` é opcional) para a raiz do repositório:
   ```bash
   git init
   git add .
   git commit -m "Sistema de arquivo de atas"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
   git push -u origin main
   ```
3. No GitHub, vá em **Settings → Pages**.
4. Em "Build and deployment", escolha **Deploy from a branch**, selecione
   a branch `main` e a pasta `/ (root)`, e clique em **Save**.
5. Após alguns instantes, o GitHub mostrará o link público, algo como
   `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`.

Nenhuma configuração adicional é necessária — os únicos recursos
externos carregados são as fontes do Google Fonts e as bibliotecas
`pdf.js` e `Chart.js` via CDN (cdnjs.cloudflare.com), que funcionam
normalmente em qualquer página hospedada no GitHub Pages.

## Abas do sistema

- **Arquivo**: uma faixa de seção separa o bloco de apresentação do conteúdo. Abaixo dela ficam dois
  cartões: "Enviar atas" (passo 1) e "Índice de atas" (passo 2, buscável e ordenável pelo cabeçalho). Em
  telas estreitas, cada ata vira um cartão, sem rolagem horizontal. No detalhe de uma ata (ou pelo ícone de
  livro na linha), **"Ler o texto da ata"** abre o texto em tela cheia, remontado em parágrafos e seções
  recuadas sob cada item da pauta, com sumário, ajuste de tamanho, cópia e destaque opcional das decisões e
  encaminhamentos identificados. Só as quebras de linha mudam; o texto não é reescrito.
- **Painel**: frequência dos temas, evolução dos temas no tempo, decisões
  por período, quantidade de encaminhamentos por ata, assuntos mais
  recorrentes, rede de relacionamento entre temas e linha do tempo das
  decisões.
- **Responsáveis**: agrupa decisões e encaminhamentos por responsável
  identificado, mostrando quantos itens cada pessoa tem e quais ainda
  estão sem prazo definido.
- **Consulta**: perguntas em linguagem natural respondidas por busca
  local (sem IA) sobre o conteúdo já extraído das atas.
