// UI strings in English (source of truth) and Brazilian Portuguese. PT-BR is typed against the EN keys, so a missing
// translation fails typecheck. Placeholders are {name}; `translate` fills them.

export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'app.tagline': 'An onchain pet on Arc',
  'app.lead':
    'Hatch a pet with genes drawn by ArcDraw. Keep it fed and happy. If nobody cares for it, it dies for good and becomes a tombstone.',
  'app.open': 'Open ArcPet',

  'nav.main': 'Main',
  'nav.skip': 'Skip to content',
  'nav.myPet': 'My pet',
  'nav.ranking': 'Oldest alive',
  'nav.graveyard': 'Graveyard',
  'nav.project': 'Project page',
  'nav.github': 'GitHub',
  'nav.home': 'ArcPet home',

  'locale.label': 'Language',
  'locale.en': 'EN',
  'locale.pt-BR': 'PT-BR',

  'wallet.connect': 'Connect wallet',
  'wallet.connecting': 'Connecting…',
  'wallet.disconnect': 'Disconnect',
  'wallet.noProvider': 'No browser wallet found. Install an EVM wallet extension to continue.',
  'wallet.switch': 'Switch to {chain}',

  'state.notDeployed.title': 'Not deployed yet',
  'state.notDeployed.body':
    'ArcPet is not deployed on {chain} yet, so there is nothing to read. The address goes in deployments/arc-mainnet.json after the mainnet deploy.',
  'state.config': 'Build configuration problem:',
  'state.loading': 'Loading…',
  'state.rpcError': 'Cannot reach the network ({rpc}). Check your connection and retry.',
  'state.retry': 'Retry',
  'state.connectToAct': 'Connect a wallet to feed, play or bury. Anyone can.',

  'status.Egg': 'Egg',
  'status.Alive': 'Alive',
  'status.Dead': 'Dead',
  'status.Buried': 'Buried',
  'mood.Egg': 'Egg',
  'mood.Happy': 'Happy',
  'mood.Hungry': 'Hungry',
  'mood.Sad': 'Sad',
  'mood.Tomb': 'Tomb',
  'species.0': 'Blob',
  'species.1': 'Cat',
  'species.2': 'Bird',
  'species.3': 'Bunny',

  'pet.hunger': 'Hunger',
  'pet.happiness': 'Happiness',
  'pet.age': 'Age',
  'pet.owner': 'Owner',
  'pet.you': 'you',
  'pet.species': 'Species',
  'pet.diesIn': 'Dies in',
  'pet.diesAt': 'Dies at {date}',
  'pet.hungryIn': 'Hungry in {time}',
  'pet.sadIn': 'Sad in {time}',
  'pet.died': 'Died {date}',
  'pet.lived': 'Lived {time}',
  'pet.deadUnburied': 'This pet is dead. Anyone can bury it; its age stays frozen at {time}.',
  'pet.feed': 'Feed',
  'pet.play': 'Play',
  'pet.bury': 'Bury',
  'pet.calendar': 'Add reminder to calendar',
  'pet.calendarHint':
    'Calendar event 6h before death (or right away if less is left). Re-add it after each feed or play.',
  'pet.share': 'Copy share link',
  'pet.copied': 'Link copied',
  'pet.openPage': 'Public page',
  'pet.image': 'Onchain art of {name}',
  'pet.anyoneCares': 'Anyone can feed or play with any pet. Share the link so friends can help.',
  'pet.notFound': 'Pet #{id} does not exist.',
  'pet.badId': 'Missing or invalid pet id. Use ?id=<number>.',
  'pet.title': '{name} #{id}',

  'my.title': 'My pet',
  'my.connect': 'Connect a wallet to hatch and care for your pet.',
  'my.none': 'You have no pet yet. Hatch one: it is free, you only pay gas.',
  'my.again':
    'Your last pet is gone. You can hatch a new one; if it is not buried yet, hatching buries it first.',
  'my.previous': 'Previous pet',

  'hatch.title': 'Hatch an egg',
  'hatch.name': 'Name',
  'hatch.nameHint': '1-20 characters: letters, digits, spaces and basic punctuation (no " & < > \\).',
  'hatch.invalidName': 'Invalid name. Use 1-20 plain ASCII characters without " & < > \\.',
  'hatch.submit': 'Hatch',
  'hatch.sending': 'Laying the egg…',

  'egg.title': 'Egg',
  'egg.waiting': 'Waiting for drand round {round} (about {time}).',
  'egg.fulfillable':
    'The randomness for this egg is public. Fetch it from drand and deliver it to ArcDraw to hatch (anyone can).',
  'egg.fulfill': 'Hatch now',
  'egg.fulfilling': 'Hatching…',
  'egg.claimable':
    'ArcDraw delivered the randomness but the hatch callback did not finish. Complete the hatch from the stored randomness.',
  'egg.claim': 'Complete hatch',
  'egg.unknown': 'The ArcDraw request of this egg was not found.',
  'egg.never': 'Eggs never decay or expire.',

  'tx.confirm': 'Confirm in your wallet…',
  'tx.pending': 'Waiting for the transaction…',
  'tx.done': 'Done',
  'tx.view': 'View transaction',
  'tx.reverted': 'The transaction reverted.',

  'error.rejected': 'You rejected the request in your wallet.',
  'error.generic': 'Something went wrong: {message}',
  'error.PetDead': 'Too late: this pet is already dead.',
  'error.NotHatched': 'This pet is still an egg.',
  'error.AlreadyHatched': 'This egg already hatched.',
  'error.NotDead': 'This pet is still alive.',
  'error.AlreadyBuried': 'This pet is already buried.',
  'error.AlreadyHasPet': 'This wallet already has an egg or a living pet.',
  'error.InvalidName': 'Invalid name.',
  'error.RequestNotFulfilled': 'The randomness is not delivered yet. Hatch now first.',
  'error.NonexistentPet': 'This pet does not exist.',
  'error.drand': 'Could not fetch the drand signature. Retry in a few seconds.',

  'ranking.title': 'Oldest alive',
  'ranking.lead': 'Living pets, oldest first. Read straight from the contract (ids 1..{total}).',
  'ranking.empty': 'No pet is alive right now.',
  'graveyard.title': 'Graveyard',
  'graveyard.lead': 'Every pet that died, longest life first. Death is permanent.',
  'graveyard.empty': 'Nobody has died yet.',
  'list.rank': '#',
  'list.pet': 'Pet',
  'list.age': 'Age',
  'list.owner': 'Owner',
  'list.status': 'Status',
  'list.loaded': 'Loaded {loaded} of {total}',

  'ics.summary': 'Feed {name} (ArcPet #{id})',
  'ics.description': '{name} dies in {time} unless someone feeds it and plays with it. Death is permanent.',

  'footer.note': 'Soulbound. No owner, no fees, no USDC in the contract. Randomness by drand via ArcDraw.',
} as const;

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const ptBR: Messages = {
  'app.tagline': 'Um bichinho onchain na Arc',
  'app.lead':
    'Choque um bichinho com genes sorteados pelo ArcDraw. Mantenha ele alimentado e feliz. Se ninguém cuidar, ele morre de vez e vira lápide.',
  'app.open': 'Abrir o ArcPet',

  'nav.main': 'Principal',
  'nav.skip': 'Pular para o conteúdo',
  'nav.myPet': 'Meu pet',
  'nav.ranking': 'Mais velhos vivos',
  'nav.graveyard': 'Cemitério',
  'nav.project': 'Página do projeto',
  'nav.github': 'GitHub',
  'nav.home': 'Início do ArcPet',

  'locale.label': 'Idioma',
  'locale.en': 'EN',
  'locale.pt-BR': 'PT-BR',

  'wallet.connect': 'Conectar carteira',
  'wallet.connecting': 'Conectando…',
  'wallet.disconnect': 'Desconectar',
  'wallet.noProvider': 'Nenhuma carteira encontrada no navegador. Instale uma extensão de carteira EVM.',
  'wallet.switch': 'Trocar para {chain}',

  'state.notDeployed.title': 'Ainda não publicado',
  'state.notDeployed.body':
    'O ArcPet ainda não foi publicado na {chain}, então não há nada para ler. O endereço entra em deployments/arc-mainnet.json depois do deploy na mainnet.',
  'state.config': 'Problema na configuração do build:',
  'state.loading': 'Carregando…',
  'state.rpcError': 'Sem acesso à rede ({rpc}). Verifique sua conexão e tente de novo.',
  'state.retry': 'Tentar de novo',
  'state.connectToAct': 'Conecte uma carteira para alimentar, brincar ou enterrar. Qualquer pessoa pode.',

  'status.Egg': 'Ovo',
  'status.Alive': 'Vivo',
  'status.Dead': 'Morto',
  'status.Buried': 'Enterrado',
  'mood.Egg': 'Ovo',
  'mood.Happy': 'Feliz',
  'mood.Hungry': 'Com fome',
  'mood.Sad': 'Triste',
  'mood.Tomb': 'Lápide',
  'species.0': 'Blob',
  'species.1': 'Gato',
  'species.2': 'Pássaro',
  'species.3': 'Coelho',

  'pet.hunger': 'Fome',
  'pet.happiness': 'Felicidade',
  'pet.age': 'Idade',
  'pet.owner': 'Dono',
  'pet.you': 'você',
  'pet.species': 'Espécie',
  'pet.diesIn': 'Morre em',
  'pet.diesAt': 'Morre em {date}',
  'pet.hungryIn': 'Fica com fome em {time}',
  'pet.sadIn': 'Fica triste em {time}',
  'pet.died': 'Morreu em {date}',
  'pet.lived': 'Viveu {time}',
  'pet.deadUnburied': 'Este pet morreu. Qualquer pessoa pode enterrá-lo; a idade fica congelada em {time}.',
  'pet.feed': 'Alimentar',
  'pet.play': 'Brincar',
  'pet.bury': 'Enterrar',
  'pet.calendar': 'Adicionar lembrete ao calendário',
  'pet.calendarHint':
    'Evento 6h antes da morte (ou já, se faltar menos). Adicione de novo depois de cada refeição ou brincadeira.',
  'pet.share': 'Copiar link',
  'pet.copied': 'Link copiado',
  'pet.openPage': 'Página pública',
  'pet.image': 'Arte onchain de {name}',
  'pet.anyoneCares':
    'Qualquer pessoa pode alimentar ou brincar com qualquer pet. Compartilhe o link para amigos ajudarem.',
  'pet.notFound': 'O pet #{id} não existe.',
  'pet.badId': 'Id do pet ausente ou inválido. Use ?id=<número>.',
  'pet.title': '{name} #{id}',

  'my.title': 'Meu pet',
  'my.connect': 'Conecte uma carteira para chocar e cuidar do seu pet.',
  'my.none': 'Você ainda não tem um pet. Choque um: é grátis, você só paga o gás.',
  'my.again':
    'Seu último pet se foi. Você pode chocar outro; se ele ainda não foi enterrado, o choque enterra antes.',
  'my.previous': 'Pet anterior',

  'hatch.title': 'Chocar um ovo',
  'hatch.name': 'Nome',
  'hatch.nameHint':
    '1 a 20 caracteres: letras sem acento, números, espaços e pontuação simples (sem " & < > \\).',
  'hatch.invalidName': 'Nome inválido. Use de 1 a 20 caracteres ASCII simples, sem " & < > \\.',
  'hatch.submit': 'Chocar',
  'hatch.sending': 'Botando o ovo…',

  'egg.title': 'Ovo',
  'egg.waiting': 'Esperando o round {round} do drand (cerca de {time}).',
  'egg.fulfillable':
    'A aleatoriedade deste ovo já é pública. Busque no drand e entregue ao ArcDraw para chocar (qualquer pessoa pode).',
  'egg.fulfill': 'Chocar agora',
  'egg.fulfilling': 'Chocando…',
  'egg.claimable':
    'O ArcDraw entregou a aleatoriedade, mas o callback de choque não terminou. Conclua o choque com a aleatoriedade guardada.',
  'egg.claim': 'Concluir choque',
  'egg.unknown': 'A requisição do ArcDraw deste ovo não foi encontrada.',
  'egg.never': 'Ovos nunca estragam nem expiram.',

  'tx.confirm': 'Confirme na sua carteira…',
  'tx.pending': 'Esperando a transação…',
  'tx.done': 'Feito',
  'tx.view': 'Ver transação',
  'tx.reverted': 'A transação reverteu.',

  'error.rejected': 'Você recusou o pedido na carteira.',
  'error.generic': 'Algo deu errado: {message}',
  'error.PetDead': 'Tarde demais: este pet já morreu.',
  'error.NotHatched': 'Este pet ainda é um ovo.',
  'error.AlreadyHatched': 'Este ovo já chocou.',
  'error.NotDead': 'Este pet ainda está vivo.',
  'error.AlreadyBuried': 'Este pet já foi enterrado.',
  'error.AlreadyHasPet': 'Esta carteira já tem um ovo ou um pet vivo.',
  'error.InvalidName': 'Nome inválido.',
  'error.RequestNotFulfilled': 'A aleatoriedade ainda não foi entregue. Use "Chocar agora" primeiro.',
  'error.NonexistentPet': 'Este pet não existe.',
  'error.drand': 'Não foi possível buscar a assinatura do drand. Tente de novo em alguns segundos.',

  'ranking.title': 'Mais velhos vivos',
  'ranking.lead': 'Pets vivos, do mais velho ao mais novo. Lido direto do contrato (ids 1..{total}).',
  'ranking.empty': 'Nenhum pet está vivo agora.',
  'graveyard.title': 'Cemitério',
  'graveyard.lead': 'Todo pet que morreu, da vida mais longa à mais curta. A morte é permanente.',
  'graveyard.empty': 'Ninguém morreu ainda.',
  'list.rank': '#',
  'list.pet': 'Pet',
  'list.age': 'Idade',
  'list.owner': 'Dono',
  'list.status': 'Estado',
  'list.loaded': '{loaded} de {total} carregados',

  'ics.summary': 'Alimente {name} (ArcPet #{id})',
  'ics.description': '{name} morre em {time} se ninguém alimentar e brincar com ele. A morte é permanente.',

  'footer.note': 'Soulbound. Sem dono, sem taxas, sem USDC no contrato. Aleatoriedade do drand via ArcDraw.',
};

const MESSAGES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

export type Vars = Record<string, string | number | bigint>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = MESSAGES[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Only for keys built at runtime (error names, enum labels); falls back to undefined when unknown. */
export function isMessageKey(k: string): k is MessageKey {
  return k in en;
}
