// Conteúdo da Gooners Law (renderizado estaticamente para SEO).

export const AREAS = [
  { icon: 'shield', title: 'Proteção patrimonial', text: 'Organização preventiva do patrimônio pessoal e empresarial, segregando os riscos da atividade e preservando os bens da família de forma lícita.',
    items: ['Mapeamento de riscos empresariais, trabalhistas e fiscais', 'Segregação entre patrimônio operacional e familiar', 'Revisão de garantias pessoais (aval e fiança)', 'Pacto antenupcial e regime de bens'] },
  { icon: 'building-2', title: 'Holding familiar e patrimonial', text: 'Constituição e governança de holdings para concentrar imóveis, participações e investimentos, com gestão centralizada.',
    items: ['Escolha do tipo societário e do regime tributário', 'Integralização de imóveis e participações', 'Acordo de sócios e protocolo familiar', 'Cláusulas de incomunicabilidade, impenhorabilidade e reversão'] },
  { icon: 'tree-pine', title: 'Planejamento sucessório', text: 'Transmissão organizada do patrimônio entre gerações, reduzindo conflitos, custos e o tempo de um inventário.',
    items: ['Doação de quotas com reserva de usufruto', 'Testamentos e legados', 'Previdência privada (PGBL/VGBL) e seguros', 'Sucessão de empresas familiares'] },
  { icon: 'globe', title: 'Estruturação offshore', text: 'Criação, manutenção e regularização de estruturas no exterior para investimento, sucessão e internacionalização.',
    items: ['Análise comparativa de jurisdições', 'Sociedades de investimento, trusts e fundações privadas', 'Contas e custódia internacionais', 'Sucessão de ativos no exterior e estate tax americano'] },
  { icon: 'file-check', title: 'Compliance fiscal internacional', text: 'Conformidade com as regras brasileiras sobre ativos no exterior e com os padrões internacionais de transparência.',
    items: ['Lei 14.754/2023 (offshores e trusts)', 'Declaração de Capitais Brasileiros no Exterior (CBE)', 'CRS, FATCA e beneficiário final', 'Regularização e mudança de residência fiscal'] },
  { icon: 'gavel', title: 'Contencioso patrimonial', text: 'Defesa do patrimônio em disputas societárias, sucessórias e em execuções, com estratégia técnica e documental.',
    items: ['Desconsideração da personalidade jurídica', 'Impenhorabilidade e bem de família', 'Disputas entre herdeiros e sócios', 'Embargos e defesas em execução'] },
];

export const STEPS = [
  ['Diagnóstico', 'Mapeamento do patrimônio, dos riscos (empresariais, familiares e sucessórios) e dos objetivos da família.'],
  ['Desenho da estrutura', 'Comparação de alternativas: holding, acordos, testamento, previdência e veículos no exterior, com custos e prazos.'],
  ['Implementação', 'Constituição de sociedades, integralização de bens, contratos, registros e declarações.'],
  ['Governança contínua', 'Revisão periódica, obrigações acessórias e adaptação a mudanças legais e familiares.'],
];

export const GOALS = { inv: 'Holding de investimentos', suc: 'Sucessão / trust', fund: 'Fundos', com: 'Operação comercial', prox: 'Proximidade com o Brasil' };
export const JUR = [
  { id: 'eua', n: 'EUA (Delaware / Wyoming)', f: '🇺🇸', sys: 'Common law', g: ['inv', 'com', 'suc'], v: 'LLC, C-Corp, trusts estaduais', crs: 'Não (FATCA)', d: 'Mercado sofisticado e segurança jurídica. Exige atenção ao estate tax sobre bens situados nos EUA para não residentes.', warn: ['LLC sem tributação federal: regime privilegiado (IN 1.037, art. 2º)', 'Estate tax para não residentes'] },
  { id: 'bvi', n: 'Ilhas Virgens Britânicas', f: '🇻🇬', sys: 'Common law', g: ['inv', 'suc'], v: 'BC Company, trusts, VISTA trust', crs: 'Sim', d: 'Veículo tradicional para holdings de investimento, com regras de substância econômica e registro de beneficiário final.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
  { id: 'cay', n: 'Ilhas Cayman', f: '🇰🇾', sys: 'Common law', g: ['fund', 'inv', 'suc'], v: 'Exempted company, fundos, STAR trust, foundation company', crs: 'Sim', d: 'Principal centro de fundos de investimento do mundo, com estruturas robustas para gestores e famílias.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
  { id: 'bah', n: 'Bahamas', f: '🇧🇸', sys: 'Common law', g: ['suc', 'inv'], v: 'IBC, trusts, fundações', crs: 'Sim', d: 'Tradição em trusts e fundações para planejamento sucessório de longo prazo.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
  { id: 'pan', n: 'Panamá', f: '🇵🇦', sys: 'Civil law', g: ['suc', 'com'], v: 'Fundação de interesse privado, S.A.', crs: 'Sim', d: 'Fundações privadas de tradição romano-germânica, próximas da lógica do direito brasileiro.', warn: ['Lista de tributação favorecida (IN 1.037, art. 1º)'] },
  { id: 'uru', n: 'Uruguai', f: '🇺🇾', sys: 'Civil law', g: ['prox', 'com', 'inv'], v: 'S.A., sociedades de responsabilidade limitada', crs: 'Sim', d: 'Proximidade geográfica e cultural com o Brasil e estabilidade institucional no Mercosul.', warn: [] },
  { id: 'sui', n: 'Suíça', f: '🇨🇭', sys: 'Civil law', g: ['inv', 'com'], v: 'AG, GmbH, gestão patrimonial', crs: 'Sim', d: 'Referência em private banking e gestão de patrimônio, com elevada estabilidade política e monetária.', warn: [] },
  { id: 'lux', n: 'Luxemburgo', f: '🇱🇺', sys: 'Civil law · UE', g: ['fund', 'inv'], v: 'SOPARFI, SICAV, RAIF, SIF', crs: 'Sim', d: 'Hub europeu de fundos e holdings, com ampla rede de tratados e acesso ao mercado da União Europeia.', warn: [] },
  { id: 'sgp', n: 'Singapura', f: '🇸🇬', sys: 'Common law', g: ['inv', 'fund', 'com'], v: 'Pte. Ltd., VCC, family office', crs: 'Sim', d: 'Centro financeiro asiático com regime estruturado para family offices e fundos.', warn: [] },
  { id: 'jer', n: 'Jersey', f: '🇯🇪', sys: 'Direito misto', g: ['suc', 'fund'], v: 'Trusts, fundações, companies', crs: 'Sim', d: 'Jurisdição consolidada para trusts e fundações, com supervisão rigorosa dos prestadores de serviço fiduciário.', warn: [] },
];

export const FAQ = [
  ['Proteção patrimonial é legal?', 'Sim, quando feita de forma preventiva, transparente e com propósito legítimo: organizar a gestão, segregar riscos de atividades e planejar a sucessão. O que a lei não admite é ocultar bens ou transferi-los para frustrar credores já existentes, o que pode configurar fraude contra credores ou fraude à execução.'],
  ['O que é uma holding familiar?', 'É uma sociedade criada para concentrar e administrar bens da família, como imóveis, participações e investimentos. Ela facilita a gestão, permite regras de governança entre os familiares e viabiliza a sucessão por meio da doação de quotas, frequentemente com reserva de usufruto.'],
  ['A holding protege contra qualquer dívida?', 'Não. A estrutura societária não é uma blindagem absoluta. Em casos de abuso, confusão patrimonial ou desvio de finalidade, a Justiça pode desconsiderar a personalidade jurídica (art. 50 do Código Civil). Por isso, a proteção depende de planejamento antecipado, substância e boa governança.'],
  ['Ter uma offshore é ilegal?', 'Não. Brasileiros podem manter sociedades, contas e investimentos no exterior, desde que declarem os bens à Receita Federal, prestem a declaração ao Banco Central quando exigida e recolham os tributos devidos.'],
  ['Como funciona a tributação de offshores desde 2024?', 'Com a Lei 14.754/2023, os lucros de entidades controladas no exterior por pessoas físicas residentes no Brasil passaram, conforme o enquadramento, a ser tributados anualmente a 15%, independentemente de distribuição. A lei também disciplinou a tributação de trusts e de aplicações financeiras no exterior.'],
  ['Trusts são reconhecidos no Brasil?', 'O Brasil não tem legislação civil própria sobre trusts, mas a Lei 14.754/2023 definiu o tratamento tributário: em regra, os bens e direitos permanecem atribuídos ao instituidor enquanto ele viver, e há regras específicas para a transmissão aos beneficiários.'],
  ['Quanto tempo leva para estruturar uma holding?', 'Depende da quantidade e da natureza dos bens. Em casos usuais, a constituição, a integralização de imóveis e os registros levam de algumas semanas a poucos meses. O diagnóstico inicial define o cronograma.'],
];

export const CHECKLIST = [
  ['Documentos pessoais', ['RG e CPF de todos os familiares envolvidos', 'Certidão de casamento ou de união estável e pacto antenupcial, se houver', 'Certidões de nascimento dos filhos', 'Comprovante de residência e de residência fiscal']],
  ['Imóveis', ['Matrículas atualizadas (até 30 dias)', 'Carnês de IPTU/ITR e valor venal', 'Escrituras e contratos de compra e venda', 'Contratos de locação vigentes']],
  ['Empresas e participações', ['Contratos sociais e alterações', 'Acordos de sócios existentes', 'Balanço e balancete recentes', 'Certidões negativas fiscais e trabalhistas']],
  ['Investimentos e ativos no exterior', ['Extratos de investimentos no Brasil', 'Declarações de IR dos últimos 2 anos', 'Declaração de Capitais Brasileiros no Exterior (CBE), se aplicável', 'Documentos societários de estruturas no exterior']],
  ['Objetivos e governança', ['Lista de herdeiros e beneficiários', 'Regras desejadas para gestão e sucessão', 'Situações sensíveis (filhos de outras uniões, herdeiros menores)', 'Garantias pessoais concedidas (aval, fiança)']],
];

export const GLOSSARY = [
  ['Beneficiário final', 'Pessoa natural que, em última instância, possui, controla ou influencia significativamente uma entidade. A Receita Federal e os padrões internacionais exigem sua identificação.'],
  ['Bem de família', 'Imóvel residencial da entidade familiar, protegido contra penhora por dívidas, salvo as exceções da Lei 8.009/1990 (como dívidas do próprio imóvel e pensão alimentícia).'],
  ['CBE', 'Declaração de Capitais Brasileiros no Exterior, prestada ao Banco Central por residentes que detêm ativos no exterior acima dos limites fixados pela regulamentação vigente.'],
  ['Cláusula de impenhorabilidade', 'Cláusula que impede que o bem doado ou herdado seja penhorado por dívidas do beneficiário, nos limites admitidos em lei.'],
  ['Cláusula de inalienabilidade', 'Restrição que impede o beneficiário de vender ou transferir o bem recebido por doação ou testamento, por prazo determinado ou vitaliciamente. Implica impenhorabilidade e incomunicabilidade (art. 1.911 do Código Civil).'],
  ['Cláusula de incomunicabilidade', 'Cláusula que impede que o bem recebido se comunique com o cônjuge ou companheiro do beneficiário, independentemente do regime de bens.'],
  ['Cláusula de reversão', 'Previsão de que o bem doado retorne ao doador caso ele sobreviva ao donatário (art. 547 do Código Civil).'],
  ['Colação', 'Dever dos descendentes de informar, no inventário, as doações recebidas em vida, para igualar as legítimas, salvo dispensa expressa do doador.'],
  ['CRS', 'Common Reporting Standard: padrão da OCDE de troca automática de informações financeiras entre países, do qual o Brasil participa.'],
  ['Desconsideração da personalidade jurídica', 'Medida judicial que permite alcançar bens dos sócios por dívidas da sociedade (ou o inverso) em caso de abuso, desvio de finalidade ou confusão patrimonial (art. 50 do Código Civil).'],
  ['Doação com reserva de usufruto', 'Doação em que o doador transfere a propriedade (nua-propriedade), mas mantém para si o direito de usar o bem e receber seus frutos, como aluguéis e dividendos.'],
  ['Doação inoficiosa', 'Parte da doação que excede o que o doador poderia dispor em testamento no momento da liberalidade, invadindo a legítima dos herdeiros necessários. É nula nessa parte (art. 549 do Código Civil).'],
  ['Entidade controlada', 'Para a Lei 14.754/2023, sociedade ou entidade no exterior em que a pessoa física residente no Brasil detém, direta ou indiretamente, controle, inclusive por meio de direitos de sócio que lhe assegurem preponderância nas deliberações.'],
  ['Estate tax', 'Imposto federal norte-americano sobre a transmissão causa mortis. Para não residentes, pode incidir sobre bens situados nos EUA acima de um limite relativamente baixo.'],
  ['FATCA', 'Foreign Account Tax Compliance Act: lei norte-americana que exige de instituições financeiras estrangeiras o reporte de contas de contribuintes dos EUA.'],
  ['Fraude à execução', 'Alienação ou oneração de bens quando já existe ação capaz de reduzir o devedor à insolvência, entre outras hipóteses do art. 792 do CPC. O ato é ineficaz perante o credor.'],
  ['Fraude contra credores', 'Transmissão de bens ou perdão de dívidas por devedor já insolvente, ou que se torne insolvente com o ato, em prejuízo de credores. Pode ser anulada (arts. 158 a 165 do Código Civil).'],
  ['Fundação privada', 'Entidade patrimonial sem sócios, prevista em algumas jurisdições estrangeiras, que administra bens segundo o estatuto do instituidor, muitas vezes com finalidade sucessória.'],
  ['Herdeiros necessários', 'Descendentes, ascendentes e cônjuge, a quem pertence, de pleno direito, metade dos bens da herança, a chamada legítima (arts. 1.845 e 1.846 do Código Civil).'],
  ['Holding patrimonial', 'Sociedade cujo objeto é deter e administrar bens próprios, como imóveis, participações societárias e investimentos, em vez de exercer uma atividade operacional.'],
  ['Integralização de capital', 'Entrega efetiva, pelo sócio, dos bens ou valores que ele se comprometeu a aportar na sociedade. Na holding, costuma envolver a transferência de imóveis.'],
  ['Inventário extrajudicial', 'Inventário feito por escritura pública em cartório, com advogado, quando há consenso entre os herdeiros. Desde a Resolução CNJ nº 571/2024, admite-se também, em certas condições, com herdeiros menores ou havendo testamento.'],
  ['ITBI', 'Imposto municipal sobre a transmissão onerosa de imóveis. A Constituição prevê imunidade na integralização de capital, com exceções para empresas de atividade imobiliária preponderante (art. 156, § 2º, I).'],
  ['ITCMD', 'Imposto estadual sobre heranças e doações. A Reforma Tributária (EC 132/2023) tornou obrigatória a progressividade das alíquotas, limitadas ao teto fixado pelo Senado.'],
  ['Legítima', 'Metade do patrimônio reservada por lei aos herdeiros necessários, que não pode ser livremente disposta em testamento ou doação.'],
  ['Offshore', 'Termo usado para sociedades, contas ou estruturas constituídas fora do país de residência do titular. É lícita quando declarada e tributada corretamente.'],
  ['Pacto antenupcial', 'Escritura pública, feita antes do casamento, em que os noivos escolhem um regime de bens diferente da comunhão parcial ou estabelecem regras patrimoniais específicas.'],
  ['Planejamento sucessório', 'Conjunto de medidas tomadas em vida para organizar a transmissão do patrimônio, como doações, testamento, holding, previdência e seguros.'],
  ['Probate', 'Procedimento judicial de inventário em países de common law, como os EUA e o Reino Unido. Pode ser longo e caro para estrangeiros com bens nesses países.'],
  ['Propósito negocial', 'Razão econômica ou organizacional, além da economia tributária, que justifica uma operação ou estrutura. É examinado pelo Fisco na análise de planejamentos tributários.'],
  ['Protocolo familiar', 'Documento que estabelece regras de convivência, governança e sucessão entre os membros de uma família empresária ou proprietária de patrimônio comum.'],
  ['Regime de bens', 'Conjunto de regras sobre a propriedade e a administração dos bens do casal: comunhão parcial, comunhão universal, separação convencional, separação obrigatória e participação final nos aquestos.'],
  ['Residência fiscal', 'Condição que define em qual país a pessoa é tributada sobre a renda mundial. A saída definitiva do Brasil exige comunicação e declaração específicas à Receita Federal.'],
  ['Testamento', 'Ato pelo qual a pessoa dispõe de seus bens para depois da morte, respeitada a legítima dos herdeiros necessários. Pode ser público, cerrado ou particular.'],
  ['Transparência fiscal', 'Opção da Lei 14.754/2023 que permite à pessoa física tratar os bens e rendimentos de uma controlada no exterior como se fossem detidos diretamente por ela.'],
  ['Trust', 'Estrutura de common law em que o instituidor (settlor) transfere bens a um administrador (trustee) para que os gerencie em benefício de terceiros (beneficiários).'],
  ['Usufruto', 'Direito real de usar um bem alheio e receber seus frutos, como aluguéis e dividendos, sem alterar sua substância.'],
];

const P = (...a) => a.map((x) => `<p>${x}</p>`).join('');
export const ARTICLES = [
  {
    slug: 'lei-14754-tributacao-offshore-trusts',
    title: 'Lei 14.754/2023: como ficou a tributação de offshores e trusts',
    desc: 'Entenda as regras de tributação de aplicações financeiras no exterior, entidades controladas (offshores) e trusts para pessoas físicas residentes no Brasil.',
    tag: 'Offshore', minutes: 7,
    sections: [
      ['O que mudou', P('A Lei nº 14.754/2023, em vigor desde 1º de janeiro de 2024, reformulou a tributação da renda auferida por pessoas físicas residentes no Brasil por meio de aplicações financeiras, entidades controladas e trusts no exterior.', 'Antes, a regra geral era o diferimento: lucros acumulados em uma sociedade no exterior só eram tributados quando distribuídos à pessoa física. A nova lei passou a prever, em determinadas hipóteses, a tributação anual desses lucros, independentemente de distribuição.')],
      ['Aplicações financeiras no exterior', P('Os rendimentos de aplicações financeiras no exterior, como juros, ganhos com fundos e com a venda de ativos, passaram a ser tributados à alíquota de 15%, apurados anualmente na Declaração de Ajuste Anual.', 'A lei também tratou da variação cambial e da compensação de perdas entre aplicações no exterior, observadas as condições legais.')],
      ['Entidades controladas (offshores)', P('Os lucros de entidades controladas no exterior podem ser tributados anualmente, a 15%, no balanço de 31 de dezembro, quando a entidade estiver em país de tributação favorecida, for beneficiária de regime fiscal privilegiado ou tiver renda ativa própria inferior a 60% da renda total.', 'Nos demais casos, de entidades com predominância de renda ativa fora daquelas jurisdições, a tributação ocorre quando os lucros são disponibilizados à pessoa física.', 'A lei também permite optar pelo regime de transparência fiscal, tratando os bens e rendimentos da controlada como se fossem detidos diretamente pela pessoa física.')],
      ['Trusts', P('O Brasil não tem um regime civil próprio para trusts, mas a Lei 14.754/2023 definiu seu tratamento tributário. Em regra, os bens e direitos do trust continuam atribuídos ao instituidor (settlor) enquanto ele viver, e os rendimentos são tributados como se fossem dele.', 'Quando os bens passam ao beneficiário, a transmissão é tratada como doação (em vida) ou herança (por morte), o que repercute também no ITCMD, cuja cobrança sobre bens no exterior foi disciplinada pela Reforma Tributária.')],
      ['Cuidados práticos', `<ul><li>Revisar o enquadramento de cada estrutura (controlada ou não, renda ativa ou passiva, jurisdição).</li><li>Manter a contabilidade da entidade no exterior em ordem, pois ela embasa o cálculo do lucro.</li><li>Conferir a dedução do imposto pago no exterior, admitida nas condições legais.</li><li>Atualizar as declarações à Receita Federal e ao Banco Central (CBE).</li></ul>`],
    ],
  },
  {
    slug: 'holding-familiar-vantagens-custos-riscos',
    title: 'Holding familiar: vantagens, custos e riscos',
    desc: 'Quando a holding familiar faz sentido, como funciona a doação de quotas com reserva de usufruto e quais cuidados evitam questionamentos.',
    tag: 'Holding', minutes: 6,
    sections: [
      ['O que é uma holding familiar', P('A holding familiar é uma sociedade, geralmente limitada, criada para deter e administrar os bens de uma família, como imóveis, participações em empresas e investimentos. Em vez de cada familiar ser dono direto de cada bem, todos passam a ser sócios da holding.')],
      ['Vantagens', `<ul><li><b>Sucessão organizada:</b> os pais podem doar as quotas aos filhos em vida, com reserva de usufruto, mantendo a gestão e a renda enquanto viverem e evitando o inventário desses bens.</li><li><b>Governança:</b> o contrato social e o acordo de sócios definem quem administra, como se decide e o que acontece em casos de divórcio, morte ou saída de um sócio.</li><li><b>Cláusulas protetivas:</b> é possível prever incomunicabilidade, impenhorabilidade, inalienabilidade temporária e reversão das quotas doadas.</li><li><b>Gestão e eficiência:</b> centralização da administração e, conforme o caso, eficiência tributária na gestão de aluguéis e investimentos.</li></ul>`],
      ['Custos e tributos', P('A holding tem custos de constituição, de contabilidade mensal e de obrigações acessórias. A integralização de imóveis pode ter imunidade de ITBI (art. 156, § 2º, I, da Constituição), mas há exceções para empresas de atividade imobiliária preponderante e limites definidos pelo STF quanto ao valor que excede o capital integralizado.', 'A doação das quotas está sujeita ao ITCMD, e as mudanças recentes, como a progressividade obrigatória trazida pela EC 132/2023, a nova tributação do consumo (IBS/CBS) sobre operações imobiliárias e as novas regras de IR sobre lucros e dividendos, precisam entrar na conta. Por isso, a comparação entre manter os bens na pessoa física e transferi-los à holding deve ser feita com números reais.')],
      ['Riscos e limites', P('A holding não é uma blindagem absoluta. Se for usada para fraudar credores já existentes, os atos podem ser anulados (fraude contra credores, arts. 158 a 165 do Código Civil) ou declarados ineficazes (fraude à execução, art. 792 do CPC). Abusos e confusão patrimonial autorizam a desconsideração da personalidade jurídica (art. 50 do Código Civil).', 'No campo sucessório, as doações devem respeitar a legítima dos herdeiros necessários: a parte que a exceder é nula (doação inoficiosa, art. 549 do Código Civil).')],
      ['Quando faz sentido', P('A holding tende a ser vantajosa para famílias com patrimônio relevante, especialmente imobiliário ou empresarial, que desejam organizar a sucessão e a gestão com antecedência. Para patrimônios menores ou muito líquidos, alternativas como testamento, previdência privada e seguros podem ser suficientes e mais baratas.')],
    ],
  },
  {
    slug: 'protecao-patrimonial-licita-limites',
    title: 'Proteção patrimonial lícita: o que é e onde estão os limites',
    desc: 'Proteção patrimonial é planejamento preventivo, não ocultação. Veja os instrumentos lícitos e as condutas que a lei não admite.',
    tag: 'Proteção patrimonial', minutes: 5,
    sections: [
      ['Planejamento, não ocultação', P('Proteção patrimonial é o conjunto de medidas lícitas, adotadas preventivamente, para reduzir a exposição do patrimônio aos riscos da vida profissional, empresarial e familiar. Ela se baseia em transparência: os bens continuam declarados e os tributos, recolhidos.', 'O momento é decisivo. Medidas tomadas antes do surgimento de dívidas e litígios, com propósito legítimo, tendem a ser respeitadas. As adotadas depois, para frustrar credores, tendem a ser desfeitas.')],
      ['Instrumentos lícitos', `<ul><li>Separação entre a empresa operacional e o patrimônio da família (por exemplo, com uma holding patrimonial).</li><li>Escolha consciente do regime de bens e pacto antenupcial.</li><li>Proteção do bem de família (Lei 8.009/1990).</li><li>Seguros de responsabilidade civil e de vida.</li><li>Previdência privada e planejamento sucessório.</li><li>Revisão de avais e fianças pessoais concedidos a empresas.</li></ul>`],
      ['O que a lei não admite', `<ul><li><b>Fraude contra credores:</b> desfazer-se de bens já estando insolvente, ou tornando-se insolvente com o ato (arts. 158 a 165 do Código Civil).</li><li><b>Fraude à execução:</b> alienar bens quando já existe ação capaz de levar à insolvência (art. 792 do CPC).</li><li><b>Simulação:</b> negócios aparentes, que escondem a realidade (art. 167 do Código Civil).</li><li><b>Confusão patrimonial:</b> misturar contas pessoais e da empresa, o que autoriza a desconsideração da personalidade jurídica (art. 50 do Código Civil).</li><li><b>Ocultação no exterior:</b> manter bens no exterior sem declará-los à Receita Federal e ao Banco Central.</li></ul>`],
      ['Como começar', P('O ponto de partida é um diagnóstico: quais bens existem, em nome de quem estão, quais riscos a atividade gera e quais são os objetivos da família. A partir daí, compara-se o custo de cada alternativa com o risco que ela reduz.')],
    ],
  },
];
