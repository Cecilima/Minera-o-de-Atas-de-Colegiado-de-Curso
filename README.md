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
js/app.js        → interface: upload, tabela, gaveta de detalhes, gráficos, busca, consulta
tests/           → testes do extrator (node tests/frases.js · node tests/run.js ata1-numerada.txt)
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
- **Prazos e referências temporais**: datas absolutas, períodos ("2026.2", "no próximo semestre"),
  datas relativas ("nas próximas semanas"), eventos ("antes da prova"), reuniões ("na próxima reunião")
  e expressões vagas ("o quanto antes"). Referências relativas são preservadas como no texto; quando há
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

- **Arquivo**: "Enviar atas" (esquerda) e "Índice de atas" (direita), lado a lado — o índice é
  buscável por ficheiro e ordenável clicando no cabeçalho da coluna.
- **Painel**: frequência dos temas, evolução dos temas no tempo, decisões
  por período, quantidade de encaminhamentos por ata, assuntos mais
  recorrentes, rede de relacionamento entre temas e linha do tempo das
  decisões.
- **Responsáveis**: agrupa decisões e encaminhamentos por responsável
  identificado, mostrando quantos itens cada pessoa tem e quais ainda
  estão sem prazo definido.
- **Consulta**: perguntas em linguagem natural respondidas por busca
  local (sem IA) sobre o conteúdo já extraído das atas.
