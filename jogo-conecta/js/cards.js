/**
 * Conecta — banco de cartas e mensagens do jogo.
 * Todo o conteúdo é em português, curto e pensado para ser lido em voz alta
 * por um adulto/parceiro de jogo ou pela leitura por voz do navegador.
 */

// Cartas de Contato Visual (tile azul, ícone de olho)
const EYE_CARDS = [
  { emoji: "👋", text: "Olhe bem nos olhinhos da pessoa ao seu lado e diga: “Oi!”" },
  { emoji: "🔢", text: "Conte até 3 olhando nos olhos do seu parceiro de jogo." },
  { emoji: "😜", text: "Faça uma careta engraçada e espere a pessoa olhar para você." },
  { emoji: "✋", text: "Olhe nos olhos de alguém e dê um toca aqui (high-five)!" },
  { emoji: "😊", text: "Quando disserem seu nome, olhe para a pessoa e sorria." },
  { emoji: "😉", text: "Olhe nos olhos do seu parceiro e pisque de brincadeira." },
  { emoji: "🙋", text: "Diga “Presente!” bem alto, olhando nos olhos de quem está com você." },
  { emoji: "😄", text: "Olhe nos olhos da pessoa e mostre com a cara o quanto você está feliz." },
  { emoji: "👋", text: "Dê um tchauzinho com a mão olhando nos olhos da pessoa." },
  { emoji: "💚", text: "Olhe nos olhos de alguém e conte uma coisa que você gosta muito." },
  { emoji: "😁", text: "Troque um sorriso grandão com quem está jogando com você." },
  { emoji: "🟩", text: "Olhe para a pessoa e mostre o seu Bloco favorito na tela." },
  { emoji: "👀", text: "Peça “olha pra mim” e espere a pessoa olhar antes de continuar." },
  { emoji: "🐢", text: "Olhe nos olhos do seu parceiro enquanto conta até 5 bem devagar." },
  { emoji: "🦸", text: "Faça uma cara de super-herói e espere alguém notar olhando para você." },
  { emoji: "😘", text: "Olhe nos olhos da pessoa e mande um beijinho no ar." },
];

// Cartas de Comunicação (tile verde, ícone de balão de fala)
const COMM_CARDS = [
  { emoji: "🙏", text: "Peça um Bloco emprestado dizendo “por favor”." },
  { emoji: "🐾", text: "Diga o nome de 3 animais que você gosta." },
  { emoji: "🎨", text: "Conte para alguém qual é a sua cor favorita e por quê." },
  { emoji: "🤝", text: "Peça ajuda dizendo: “Você pode me ajudar?”" },
  { emoji: "💭", text: "Diga como você está se sentindo agora: feliz, calmo ou animado?" },
  { emoji: "🎵", text: "Escolha uma música e cante um pedacinho dela." },
  { emoji: "👉", text: "Aponte para um objeto na sala e diga o nome dele." },
  { emoji: "🙏", text: "Diga “obrigado” para quem está jogando com você." },
  { emoji: "❓", text: "Faça uma pergunta para o seu parceiro de jogo." },
  { emoji: "😂", text: "Conte uma coisa engraçada que aconteceu hoje." },
  { emoji: "🙆", text: "Diga “sim” ou “não” para uma pergunta que alguém te fizer." },
  { emoji: "🔁", text: "Peça “minha vez” antes de deixar a outra pessoa jogar." },
  { emoji: "🎮", text: "Fale o nome de um jogo ou brinquedo que você adora." },
  { emoji: "🙌", text: "Diga “eu consegui!” bem animado depois de jogar." },
  { emoji: "🟦", text: "Descreva o seu Bloco: de que cor ele é? o que ele está usando?" },
  { emoji: "🎲", text: "Convide a pessoa para jogar a próxima rodada com você." },
];

// Mensagens dos espaços-bônus (tile dourado, ícone de estrela)
const STAR_MESSAGES = [
  { emoji: "✋", text: "Comemorem com um toca aqui (high-five)!" },
  { emoji: "💃", text: "Dancem juntos por 5 segundinhos!" },
  { emoji: "👏", text: "Batam palma 3 vezes e gritem “Conseguimos!”" },
  { emoji: "🎉", text: "Façam a dancinha da vitória!" },
  { emoji: "🤗", text: "Abracem-se rapidinho para comemorar!" },
  { emoji: "🙌", text: "Levantem os braços e gritem “Uhuul!”" },
  { emoji: "😄", text: "Deem uma risada juntos, bem alto!" },
  { emoji: "🎶", text: "Balancem a cabeça no ritmo de uma música favorita!" },
];

// Mensagens de volta completa (ao passar pelo espaço Início)
const LAP_MESSAGES = [
  "Volta completa! Vocês são demais!",
  "Mais uma volta na trilha! Continuem brincando!",
  "Uhuul, voltou para o Início! Bônus de estrelas!",
  "Circuito completo! Que dupla incrível!",
];

// Acessórios do avatar de blocos, desbloqueados por estrelas acumuladas
const ACCESSORIES = [
  { id: "none", label: "Nenhum", emoji: "🟦", cost: 0 },
  { id: "bone", label: "Boné", emoji: "🧢", cost: 3 },
  { id: "oculos", label: "Óculos de estrela", emoji: "🕶️", cost: 6 },
  { id: "capa", label: "Capa", emoji: "🦸", cost: 10 },
  { id: "coroa", label: "Coroa", emoji: "👑", cost: 15 },
];

// Cores disponíveis para o corpo do avatar de blocos
const AVATAR_COLORS = [
  { id: "green", value: "#22C55E" },
  { id: "blue", value: "#3B82F6" },
  { id: "orange", value: "#F97316" },
  { id: "pink", value: "#EC4899" },
  { id: "purple", value: "#A855F7" },
  { id: "yellow", value: "#EAB308" },
];
