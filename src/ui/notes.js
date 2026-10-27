// Documentos encontrados pelo predio. Contam a historia e ensinam as mecanicas sem tutorial explicito.
export const NOTES = {
  aviso: {
    title: 'Aviso ao Plantão Noturno',
    meta: 'Administração · 12 de agosto de 1983',
    body: [
      'A porta principal possui TRAVA ELETROMAGNÉTICA. Por norma de contenção, em caso de queda de energia ela PERMANECE TRANCADA.',
      'O quadro geral da porta fica na parede da recepção, à esquerda da saída. Cinco fusíveis de porcelana. Sem os cinco, não há corrente.',
      'Após restabelecer os fusíveis, puxar a alavanca e AGUARDAR a carga completa da trava (aprox. 30 segundos). Durante a carga, o restante do prédio fica sem energia.',
    ],
    hand: 'Alguém tirou todos os fusíveis do quadro. Não fui eu. — M.',
  },
  vigia: {
    title: 'Livro de Ocorrências — Vigilância',
    meta: 'Posto 2 · noite de 4 para 5 de agosto',
    // as pistas dos fusiveis mudam a cada partida (o jogo passa 3 dos lugares sorteados; os outros ele "nao anotou")
    dynamic: (hints) => [
      '02h10 — Gaveta 13 do necrotério aberta por dentro. Maca vazia. Rastro até o corredor norte.',
      '02h40 — Ele passou pela recepção. Não gosta das luzes. Apontei a lanterna na cara dele e ele gritou e recuou. Mas voltou. Sempre volta.',
      '03h15 — Tirei os fusíveis da porta principal. Se ele sair, não para mais. Espalhei os fusíveis pelo prédio para ninguém recolocar sem pensar. Só anotei alguns lugares:',
      hints && hints.length ? hints.map(h => '• ' + h).join('<br>') + '<br>Os outros eu nem lembro onde deixei. Procurem em tudo que tem uma superfície: mesas, camas, macas, gavetas.' : 'Deixei em mesas, camas, macas e até nas gavetas do necrotério. Não anotei onde.',
      'A chave do subsolo fica aqui na mesa. Ele é grande demais para os dutos: ouça os passos, não os dutos.',
    ],
    hand: 'Se você está lendo isto, eu não consegui sair.',
  },
  diario: {
    title: 'Caderno (letra de criança)',
    meta: 'Quarto 2 · sem data',
    body: [
      'Eles apagam a luz às oito. Quando apagam, ele anda.',
      'Eu fico embaixo da cama e seguro o ar até ele ir embora. Ele escuta. Ele escuta TUDO. Se correr ele escuta. Se abrir porta ele escuta.',
      'Ele cheira a gente de perto. Quando ele para na frente da cama eu não respiro.',
      'A luz forte ele não aguenta. Mas a lanterna do seu Moacir esquenta e apaga.',
    ],
    hand: 'Anotação do plantão — 31/07/1983: Lia, Davi, Nina, Tomás, Bia e Ivo. Seis óbitos na ala. Os pertences ficaram nos quartos, à espera das famílias. Ninguém veio buscar. O pato de corda não tem mais mola. Não deveria tocar.',
  },
  enfermagem: {
    title: 'Prontuário de Enfermagem',
    meta: 'Paciente nº 13 (T.) · Ala B',
    body: [
      '14/06 — Transferido para a Ala Noturna por ordem do Dr. Varela. Protocolo de Escuridão Prolongada: 40 dias sem luz.',
      '02/07 — Pupilas não contraem. Paciente não tolera nem a luz do corredor. Grita quando a porta abre.',
      '19/07 — Paciente parou de comer. Unhas cresceram de forma anormal. Anda à noite, arrastando a perna.',
      '28/07 — Óbito atestado pelo Dr. Varela. Encaminhado ao necrotério.',
    ],
    hand: 'Ele não estava frio quando levamos.',
  },
  autopsia: {
    title: 'Laudo de Necropsia nº 13/83',
    meta: 'Serviço de Verificação de Óbitos',
    body: [
      'Cadáver masculino, estatura incompatível com a ficha de admissão (+ 40 cm). Membros superiores desproporcionalmente longos.',
      'Incisão em Y realizada e suturada. Rigidez cadavérica ausente após 72 horas. Olhos: pupilas totalmente dilatadas, com reflexo retiniano intenso (tapetum?).',
      'Corpo recolhido à GAVETA 13.',
      '04/08: gaveta 13 encontrada aberta. Corpo ausente. Arranhões no lado de dentro da porta.',
    ],
  },
  pesquisa: {
    title: 'Memorando — Dr. A. Varela',
    meta: 'Laboratório · confidencial',
    body: [
      'Hipótese confirmada: a retina adaptada à escuridão total torna-se hipersensível. Luz difusa apenas o irrita — mas denuncia quem a carrega.',
      'Um feixe CONCENTRADO direto nos OLHOS, sustentado por menos de um segundo, provoca dor intensa e desorientação. No corpo, não surte efeito; apenas o enfurece.',
      'A cada exposição ele se adapta: protege o rosto com os braços e exige mais tempo de luz.',
      'Nota técnica: a lanterna de serviço superaquece no modo concentrado. Poucos segundos de uso contínuo e o bulbo apaga até esfriar.',
    ],
  },
  noturna: {
    title: 'Última anotação',
    meta: 'Ala Noturna · parede da cela 4',
    body: [
      'Nós o fizemos para o escuro. E o escuro o aceitou.',
      'Ele segue a energia. Quando a porta principal carregar, todas as luzes do prédio vão apagar e ele vai saber exatamente onde você está.',
      'Não fique parado no escuro. Não pare de iluminar o rosto dele. Espere a porta abrir.',
    ],
    hand: 'Perdoe-me, Tomás. — A.V.',
  },
};
