// Conteúdo editorial (SEO) das páginas de ferramentas: título, passo a passo e perguntas frequentes.
// `title` é opcional — sem ele, usa "<nome> online grátis".

export const SITE = {
  name: 'Gooners',
  tagline: 'Ferramentas online grátis',
  description: 'Mais de 60 ferramentas online grátis: contador de caracteres, gerador de senha, CPF, QR Code Pix, consulta CEP e CNPJ, conversores e calculadoras. Sem cadastro.',
};

export const POPULAR = ['contador-caracteres', 'inverter-texto', 'gerador-senha', 'gerador-pix', 'gerador-cpf', 'consulta-cep', 'gerador-qrcode', 'numero-por-extenso', 'conversor-moedas', 'letras-diferentes', 'diferenca-datas', 'consulta-cnpj'];

export const HOME_FAQ = [
  ['O Gooners é gratuito?', 'Sim. Todas as ferramentas são gratuitas, sem cadastro e sem limite de uso.'],
  ['Meus textos e arquivos são enviados para algum servidor?', 'Não. As ferramentas processam os dados no seu próprio navegador. Só as consultas de CEP, CNPJ e cotações acessam serviços públicos, enviando apenas o número consultado.'],
  ['Funciona no celular e sem internet?', 'Sim. O site é responsivo e pode ser instalado como aplicativo (PWA). Depois da primeira visita, a maioria das ferramentas funciona offline.'],
  ['Posso salvar minhas ferramentas favoritas?', 'Sim. Clique na estrela de qualquer ferramenta para adicioná-la aos favoritos, que ficam salvos neste navegador.'],
];

const GEN_FAQ = () => [
  ['Esta ferramenta é gratuita?', 'Sim, é totalmente gratuita, sem cadastro e sem limite de uso.'],
  ['Os dados que digito ficam salvos?', 'Não. O processamento acontece no seu navegador e nada é enviado ou armazenado em servidores.'],
];

export const TOOLS_SEO = {
  'inverter-texto': { title: 'Inverter texto online — letras, palavras e de cabeça para baixo', how: ['Digite ou cole o texto no campo de entrada.', 'Escolha o modo: inverter letras, ordem das palavras, cada palavra, linhas ou de cabeça para baixo.', 'Copie o resultado com um clique.'], faq: [['Como escrever de trás para frente?', 'Use o modo “Inverter letras”: o texto é espelhado caractere por caractere, inclusive com acentos e emojis.']] },
  'contador-caracteres': { title: 'Contador de caracteres e palavras online', how: ['Cole ou digite o texto.', 'Veja em tempo real caracteres (com e sem espaços), palavras, linhas, parágrafos e frases.', 'Confira se o texto cabe nos limites de redes sociais, SMS e SEO.'], faq: [['Quantos caracteres cabem em um tweet?', 'O limite padrão do X (Twitter) é de 280 caracteres.'], ['Como é calculado o tempo de leitura?', 'Consideramos a média de 200 palavras por minuto para leitura silenciosa e 130 para fala.']] },
  'maiusculas-minusculas': { title: 'Converter maiúsculas e minúsculas online', how: ['Cole o texto.', 'Escolha o formato: MAIÚSCULAS, minúsculas, Título, Frase, alternado, camelCase, snake_case e outros.', 'Copie o texto convertido.'] },
  'letras-diferentes': { title: 'Letras diferentes para Instagram, WhatsApp e bio', how: ['Digite seu nome ou frase.', 'Veja o texto em mais de 15 estilos (negrito, cursiva, gótico, riscado e outros).', 'Clique em “Copiar” e cole no Instagram, WhatsApp, Discord ou TikTok.'], faq: [['As letras diferentes funcionam em qualquer app?', 'Elas usam caracteres Unicode, compatíveis com a maioria dos apps e redes sociais. Alguns dispositivos antigos podem não exibir todos os estilos.']] },
  'remover-acentos': { how: ['Cole o texto com acentos.', 'O resultado sem acentos e cedilha aparece instantaneamente.', 'Copie o texto limpo.'] },
  'gerador-slug': { title: 'Gerador de slug e URL amigável para SEO', how: ['Digite o título da página ou do artigo (um por linha).', 'Escolha o separador.', 'Copie o slug sem acentos, espaços ou caracteres especiais.'] },
  'ordenar-linhas': { title: 'Ordenar linhas em ordem alfabética e remover duplicadas', how: ['Cole a lista, um item por linha.', 'Escolha a ordenação e marque as limpezas desejadas.', 'Copie a lista organizada.'] },
  'remover-espacos': { how: ['Cole o texto, inclusive o copiado de PDF.', 'Escolha remover espaços duplicados, juntar linhas ou corrigir quebras de PDF.', 'Copie o texto corrigido.'] },
  'localizar-substituir': { how: ['Cole o texto.', 'Informe o termo a localizar e o novo termo.', 'Ative expressão regular ou diferenciação de maiúsculas, se precisar, e copie o resultado.'] },
  'comparar-textos': { title: 'Comparar textos online — diferenças entre duas versões', how: ['Cole a versão original à esquerda.', 'Cole a versão modificada à direita.', 'Veja as linhas adicionadas em verde e as removidas em vermelho.'], faq: [['Serve para comparar contratos?', 'Sim. A comparação linha a linha ajuda a localizar cláusulas alteradas entre duas minutas.']] },
  'lorem-ipsum': { how: ['Escolha a quantidade e o tipo (parágrafos, frases ou palavras).', 'Clique em “Gerar novamente” para variar o texto.', 'Copie o Lorem Ipsum.'] },
  'numero-por-extenso': { title: 'Número por extenso — valores em reais para cheque e contrato', how: ['Digite o número ou o valor (ex.: 1.234,56).', 'Escolha entre valor em reais ou número simples.', 'Copie o valor por extenso, em minúsculas ou maiúsculas.'], faq: [['Como escrever R$ 1.000.000,00 por extenso?', '“Um milhão de reais”. Quando o valor termina em milhão ou bilhão exato, usa-se a preposição “de”.'], ['Até quanto o conversor funciona?', 'Até números com 21 dígitos (quintilhões), com centavos.']] },
  'gerador-senha': { title: 'Gerador de senha forte e segura', how: ['Defina o tamanho da senha.', 'Escolha os tipos de caracteres (maiúsculas, minúsculas, números e símbolos).', 'Clique em “Gerar” e copie a senha.'], faq: [['As senhas geradas são seguras?', 'Sim. Usamos o gerador criptográfico do navegador (crypto.getRandomValues) e nada sai do seu dispositivo.'], ['Qual tamanho de senha é recomendado?', 'Pelo menos 12 a 16 caracteres, combinando letras, números e símbolos. Use um gerenciador de senhas para guardá-las.']] },
  'gerador-cpf': { title: 'Gerador de CPF válido para testes', how: ['Escolha a região fiscal (opcional).', 'Defina a quantidade e se quer pontuação.', 'Clique em “Gerar” e copie os CPFs.'], faq: [['O CPF gerado é de uma pessoa real?', 'Não. São números matematicamente válidos para testar sistemas. Usá-los para fraudes é crime.'], ['O que indica o 9º dígito do CPF?', 'A região fiscal onde o documento foi emitido. Por exemplo, 8 corresponde a São Paulo.']] },
  'gerador-cnpj': { title: 'Gerador de CNPJ válido (numérico e alfanumérico)', how: ['Escolha a quantidade.', 'Marque o formato alfanumérico, se quiser testar o novo padrão.', 'Gere e copie os CNPJs.'], faq: [['O que é o CNPJ alfanumérico?', 'É o novo formato de CNPJ instituído pela Receita Federal (IN RFB nº 2.229/2024), com letras e números nas 12 primeiras posições.']] },
  'gerador-uuid': { how: ['Escolha a versão: v4 (aleatório) ou v7 (ordenado por tempo).', 'Defina a quantidade e o formato.', 'Copie um ou todos os identificadores.'] },
  'sorteador-numeros': { title: 'Sorteador de números online', how: ['Defina o intervalo (mínimo e máximo) e a quantidade.', 'Escolha se pode repetir e se deve ordenar.', 'Clique em “Sortear”, ou use os atalhos de Mega-Sena, Lotofácil e Quina.'] },
  'sorteador-nomes': { title: 'Sorteador de nomes e divisor de times', how: ['Digite os participantes, um por linha.', 'Escolha sortear vencedores, dividir em times ou gerar uma ordem aleatória.', 'Clique em “Sortear”.'] },
  'cara-ou-coroa': { how: ['Clique em “Moeda” para cara ou coroa.', 'Ou escolha um dado: D4, D6, D8, D10, D12, D20 ou D100.', 'Veja o histórico das últimas jogadas.'] },
  'gerador-qrcode': { title: 'Gerador de QR Code grátis — link, Wi-Fi e WhatsApp', how: ['Escolha o tipo: texto/link, Wi-Fi, WhatsApp ou e-mail.', 'Preencha os dados e ajuste o tamanho e a cor.', 'Baixe o QR Code em PNG.'], faq: [['O QR Code expira?', 'Não. O QR Code gerado aqui é estático e funciona para sempre, sem redirecionamentos.']] },
  'gerador-pix': { title: 'Gerador de QR Code Pix e Pix Copia e Cola', how: ['Informe o tipo e a chave Pix.', 'Preencha o nome do recebedor, a cidade e, se quiser, o valor.', 'Copie o Pix Copia e Cola ou baixe o QR Code para receber o pagamento.'], faq: [['O QR Code Pix gerado é seguro?', 'O código é gerado no seu navegador no padrão BR Code do Banco Central. Quem paga vê o nome do recebedor no app do banco antes de confirmar.'], ['Posso gerar Pix sem valor definido?', 'Sim. Deixe o valor em branco e quem paga digita o valor no momento do pagamento.']] },
  'link-whatsapp': { title: 'Gerador de link do WhatsApp com mensagem', how: ['Digite o número com DDD.', 'Escreva a mensagem que será preenchida automaticamente.', 'Copie o link wa.me ou o código HTML do botão.'] },
  'gerador-dados-teste': { title: 'Gerador de pessoas fictícias para testes', how: ['Escolha quantas pessoas gerar.', 'Selecione a visualização, JSON ou CSV.', 'Copie ou baixe os dados de teste.'] },
  'validador-cpf-cnpj': { title: 'Validador de CPF e CNPJ online', how: ['Cole um ou vários documentos, um por linha.', 'O tipo é detectado automaticamente.', 'Veja quais são válidos pelos dígitos verificadores.'], faq: [['Validar o CPF garante que ele existe?', 'Não. A validação confere apenas os dígitos verificadores. A situação cadastral é consultada na Receita Federal.']] },
  'validador-cartao': { how: ['Digite o número do cartão.', 'Veja a bandeira identificada.', 'Confira se o número passa no algoritmo de Luhn.'] },
  'validador-email': { how: ['Cole a lista de e-mails ou um texto qualquer.', 'Escolha validar a lista ou extrair os e-mails do texto.', 'Copie apenas os endereços válidos.'] },
  'testador-regex': { how: ['Digite a expressão regular e as flags.', 'Cole o texto de teste.', 'Veja as correspondências destacadas e os grupos capturados.'] },
  'consulta-cep': { title: 'Consulta CEP — buscar endereço e CEP pelo nome da rua', how: ['Digite o CEP e clique em “Consultar” para ver o endereço completo.', 'Ou informe UF, cidade e rua para descobrir o CEP.', 'Copie os dados ou abra o local no mapa.'], faq: [['De onde vêm os dados de CEP?', 'Do ViaCEP, um serviço público e gratuito baseado na base dos Correios.']] },
  'consulta-cnpj': { title: 'Consulta CNPJ grátis — razão social, situação e sócios', how: ['Digite o CNPJ da empresa.', 'Clique em “Consultar”.', 'Veja a situação cadastral, as atividades, o endereço, o capital social e o quadro de sócios.'], faq: [['Os dados do CNPJ são oficiais?', 'São os dados públicos abertos da Receita Federal, disponibilizados pela BrasilAPI, e podem ter alguns dias de defasagem.']] },
  'conversor-moedas': { title: 'Conversor de moedas — cotação do dólar e do euro hoje', how: ['Digite o valor.', 'Escolha a moeda de origem e a de destino.', 'Veja a conversão e a cotação das principais moedas.'], faq: [['A cotação inclui IOF e spread?', 'Não. É a taxa de referência de mercado. Bancos e casas de câmbio aplicam spread e IOF.']] },
  'feriados-nacionais': { title: 'Feriados nacionais e pontos facultativos', how: ['Escolha o ano.', 'Inclua ou não os pontos facultativos (Carnaval e Corpus Christi).', 'Veja as datas, os dias da semana e quanto falta para cada feriado.'], faq: [['O Dia da Consciência Negra é feriado nacional?', 'Sim. Desde 2024, por força da Lei nº 14.759/2023, 20 de novembro é feriado nacional.']] },
  'base64': { how: ['Cole o texto ou escolha um arquivo.', 'Selecione codificar ou decodificar.', 'Copie o resultado em Base64 ou em texto.'] },
  'url-encode': { how: ['Cole a URL ou o parâmetro.', 'Escolha codificar ou decodificar.', 'Copie o resultado.'] },
  'texto-binario': { how: ['Digite o texto ou os bytes.', 'Escolha a conversão (binário, hexadecimal, octal ou decimal).', 'Copie o resultado.'] },
  'bases-numericas': { how: ['Digite o número em qualquer campo.', 'Os demais campos são convertidos automaticamente.', 'Use a base personalizada para bases de 2 a 36.'] },
  'conversor-unidades': { title: 'Conversor de unidades de medida', how: ['Escolha a grandeza (comprimento, massa, área, temperatura e outras).', 'Digite o valor e escolha as unidades.', 'Veja a conversão para todas as unidades da grandeza.'] },
  'conversor-cores': { how: ['Escolha a cor no seletor ou digite em HEX, RGB ou HSL.', 'Veja a conversão entre os formatos e a paleta de tons.', 'Confira o contraste WCAG com texto branco e preto.'] },
  'codigo-morse': { how: ['Digite o texto ou o código Morse.', 'Escolha a direção da tradução.', 'Clique em “Ouvir” para escutar o código.'] },
  'timestamp-unix': { how: ['Cole um timestamp em segundos ou milissegundos.', 'Ou escolha uma data para obter o timestamp.', 'Veja a data local, UTC, ISO 8601 e o tempo relativo.'] },
  'conversor-imagem': { title: 'Converter e comprimir imagem — PNG, JPG e WebP', how: ['Selecione ou arraste a imagem.', 'Escolha o formato, a qualidade e a largura máxima.', 'Compare os tamanhos e baixe a nova imagem.'], faq: [['A imagem é enviada para a internet?', 'Não. A conversão é feita no seu dispositivo, com o Canvas do navegador.']] },
  'csv-json': { how: ['Cole o CSV (com vírgula, ponto e vírgula ou tabulação) ou o JSON.', 'Escolha a direção da conversão.', 'Copie o resultado.'] },
  'numeros-romanos': { how: ['Digite um número de 1 a 3.999 ou um numeral romano.', 'A conversão é instantânea nos dois sentidos.', 'Copie o resultado.'] },
  'calculadora-porcentagem': { title: 'Calculadora de porcentagem online', how: ['Escolha o cálculo: X% de Y, quantos % X é de Y, variação percentual ou aumento/desconto.', 'Preencha os valores.', 'O resultado aparece na hora.'] },
  'calculadora-idade': { how: ['Informe a data de nascimento.', 'Opcionalmente, mude a data de referência.', 'Veja a idade exata, os dias vividos e quanto falta para o próximo aniversário.'] },
  'diferenca-datas': { title: 'Calcular dias entre datas e dias úteis com feriados', how: ['Informe a data inicial e a final para ver dias corridos e úteis.', 'Marque se quer descontar os feriados nacionais.', 'Para contar prazos, some dias corridos ou úteis a uma data.'], faq: [['A calculadora considera feriados?', 'Sim, os feriados nacionais (e, opcionalmente, Carnaval e Corpus Christi). Feriados estaduais e municipais não são considerados.']] },
  'regra-de-tres': { how: ['Escolha proporção direta ou inversa.', 'Preencha A, B e C.', 'Veja o valor de X.'] },
  'juros-compostos': { title: 'Calculadora de juros compostos com aporte mensal', how: ['Informe o valor inicial e o aporte mensal.', 'Defina a taxa de juros (ao mês ou ao ano) e o prazo.', 'Veja o montante final, os juros e o gráfico da evolução.'] },
  'calculadora-financiamento': { title: 'Simulador de financiamento — Tabela Price e SAC', how: ['Informe o valor do bem, a entrada, a taxa e o prazo.', 'Escolha Price (parcelas fixas) ou SAC (parcelas decrescentes).', 'Veja as parcelas, os juros totais e a tabela de amortização.'], faq: [['Qual a diferença entre SAC e Price?', 'No SAC a amortização é constante e as parcelas diminuem com o tempo. Na Price as parcelas são fixas, mas o total de juros costuma ser maior.']] },
  'calculadora-horas': { title: 'Calculadora de horas e minutos', how: ['Digite as durações, uma por linha (use “-” para subtrair).', 'Veja o total em horas, minutos e formato decimal.', 'Calcule a jornada entre a entrada e a saída, descontando o intervalo.'] },
  'estatistica': { how: ['Cole os números separados por espaço, linha ou ponto e vírgula.', 'Veja média, mediana, moda, desvio padrão, variância e quartis.', 'Use o desvio da amostra ou da população, conforme o caso.'] },
  'calculadora-imc': { how: ['Digite o peso em kg e a altura em metros.', 'Veja o IMC e a classificação da OMS.', 'Confira a faixa de peso saudável para sua altura.'] },
  'formatador-json': { title: 'Formatador e validador de JSON online', how: ['Cole o JSON.', 'Escolha formatar, minificar ou ordenar as chaves.', 'Erros de sintaxe são exibidos na hora.'] },
  'gerador-hash': { how: ['Digite o texto.', 'Veja os hashes MD5, SHA-1, SHA-256, SHA-384 e SHA-512.', 'Copie o hash desejado.'] },
  'decodificador-jwt': { how: ['Cole o token JWT (com ou sem “Bearer”).', 'Veja o header e o payload decodificados.', 'Confira as datas de emissão e de expiração.'] },
  'escapar-html': { how: ['Cole o HTML ou o texto.', 'Escolha escapar ou desescapar.', 'Copie o resultado.'] },
  'markdown-html': { title: 'Editor Markdown online com preview', how: ['Escreva ou cole Markdown no editor.', 'Acompanhe a prévia formatada ao vivo.', 'Copie o HTML ou baixe os arquivos .md e .html.'] },
  'gerador-meta-tags': { title: 'Gerador de meta tags SEO, Open Graph e Twitter Card', how: ['Preencha o título, a descrição, a URL e a imagem.', 'Ajuste os textos pelos contadores de caracteres e pela prévia do Google.', 'Copie o código e cole no <head> do seu site.'], faq: [['Qual o tamanho ideal do title e da description?', 'Em geral, até cerca de 60 caracteres no título e 160 na descrição, para não serem cortados no Google.']] },
  'cronometro': { how: ['Clique em “Iniciar”.', 'Use “Volta” para registrar parciais.', 'Pause, continue ou zere quando quiser.'] },
  'timer-pomodoro': { title: 'Timer Pomodoro online', how: ['Escolha um ciclo (foco de 25 min, pausa curta ou longa) ou defina o tempo.', 'Clique em “Iniciar”.', 'Um alarme toca ao final da contagem.'] },
  'relogio-mundial': { how: ['Veja a hora atual nas principais cidades e centros financeiros.', 'Os ícones indicam se é dia ou noite em cada local.', 'Os horários se atualizam a cada segundo.'] },
  'texto-em-voz': { title: 'Ler texto em voz alta — conversor de texto em fala', how: ['Cole o texto.', 'Escolha a voz, a velocidade e o tom.', 'Clique em “Ouvir”.'] },
  'bloco-de-notas': { title: 'Bloco de notas online com salvamento automático', how: ['Escreva: tudo é salvo automaticamente neste navegador.', 'Crie várias notas e alterne entre elas.', 'Baixe a nota em .txt quando quiser.'] },
};

export function seoFor(tool) {
  const s = TOOLS_SEO[tool.id] || {};
  return {
    title: s.title || `${tool.name} online grátis`,
    how: s.how || ['Preencha os campos da ferramenta.', 'O resultado aparece instantaneamente.', 'Copie ou baixe o resultado.'],
    faq: [...(s.faq || []), ...GEN_FAQ().map(([q, a], i) => (i === 1 && tool.cat === 'consultas' ? [q, 'Apenas o dado consultado (CEP, CNPJ ou moeda) é enviado ao serviço público de origem. Nada fica armazenado no Gooners.'] : [q, a]))],
  };
}
