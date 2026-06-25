import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = loadEnv();
const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Defina SUPABASE_URL e SUPABASE_ANON_KEY no .env antes de rodar o seed.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const librarySeed = [
  {
    name: "Eu fazia isso errado no começo",
    category: "gancho",
    context: ["storytelling", "educacional"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Abre uma história pessoal e promete uma correção simples.",
    example: "Eu fazia isso errado no começo do meu treino, e era por isso que eu não evoluía."
  },
  {
    name: "POV: você tentou simplificar",
    category: "gancho",
    context: ["humor", "lifestyle"],
    platforms: ["instagram", "tiktok"],
    notes: "Funciona para mostrar uma tentativa real que saiu mais caótica do que parecia.",
    example: "POV: você tentou gravar só um vídeo rápido e virou uma produção inteira."
  },
  {
    name: "Três segundos para salvar seu conteúdo",
    category: "gancho",
    context: ["upbeat", "educacional"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Gancho direto para dica prática e rápida.",
    example: "Três segundos para salvar sua legenda antes dela ficar genérica."
  },
  {
    name: "Erro comum + correção",
    category: "formato",
    context: ["educacional"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Mostre o erro, o impacto e a versão corrigida.",
    example: "Erro: começar o vídeo sem contexto. Correção: mostrar o resultado antes do passo a passo."
  },
  {
    name: "Bastidor em três atos",
    category: "formato",
    context: ["storytelling", "lifestyle"],
    platforms: ["instagram", "tiktok"],
    notes: "Antes, durante e depois de uma rotina real.",
    example: "Antes do treino, ajuste de câmera, take final com aprendizados."
  },
  {
    name: "Lista salva-vida",
    category: "formato",
    context: ["educacional", "upbeat"],
    platforms: ["instagram", "shorts"],
    notes: "Checklist curto para o público salvar e repetir.",
    example: "5 coisas para conferir antes de postar um Reels de treino."
  },
  {
    name: "Câmera baixa em movimento",
    category: "angulo_camera",
    context: ["upbeat", "lifestyle"],
    platforms: ["instagram", "tiktok"],
    notes: "Dá energia para treino, caminhada, bastidor ou preparação.",
    example: "Celular perto do chão acompanhando o tênis entrando na academia."
  },
  {
    name: "Plano detalhe de decisão",
    category: "angulo_camera",
    context: ["storytelling", "educacional"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Foca em mãos, tela, anotação ou equipamento para reforçar uma escolha.",
    example: "Close no bloco com a frase do roteiro antes de começar a gravar."
  },
  {
    name: "Selfie honesta pós-erro",
    category: "angulo_camera",
    context: ["humor", "storytelling"],
    platforms: ["instagram", "tiktok"],
    notes: "Câmera frontal para comentário rápido depois de algo dar errado.",
    example: "Eu achei que esse take ia funcionar. Não funcionou."
  },
  {
    name: "Beat leve de rotina",
    category: "musica",
    context: ["lifestyle", "upbeat"],
    platforms: ["instagram", "tiktok"],
    notes: "Base discreta para bastidores, organização e treino leve.",
    example: "Use em montagem de mesa, garrafa, tênis e primeira série."
  },
  {
    name: "Tensão curta para virada",
    category: "musica",
    context: ["storytelling"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Aumenta expectativa antes de revelar erro, resultado ou aprendizado.",
    example: "Entrar antes da frase: foi aqui que eu percebi o problema."
  },
  {
    name: "Som divertido de microfalha",
    category: "musica",
    context: ["humor"],
    platforms: ["tiktok", "instagram"],
    notes: "Base com clima leve para tentativa, erro e reação.",
    example: "Usar quando a câmera cai, o áudio falha ou o take fica estranho."
  },
  {
    name: "Whoosh de transição",
    category: "efeito_sonoro",
    context: ["upbeat", "educacional"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Marca cortes entre passos de uma explicação.",
    example: "Whoosh entre aquecimento, série principal e alongamento."
  },
  {
    name: "Click de confirmação",
    category: "efeito_sonoro",
    context: ["educacional"],
    platforms: ["instagram", "tiktok"],
    notes: "Reforça itens de checklist ou acertos visuais.",
    example: "Click quando aparecer: luz, enquadramento, legenda, CTA."
  },
  {
    name: "Record scratch de surpresa",
    category: "efeito_sonoro",
    context: ["humor", "storytelling"],
    platforms: ["tiktok", "instagram"],
    notes: "Interrompe a cena para uma reação ou aprendizado inesperado.",
    example: "Corta no momento em que você percebe que gravou sem microfone."
  },
  {
    name: "Salva para usar antes de postar",
    category: "cta",
    context: ["educacional"],
    platforms: ["instagram", "shorts"],
    notes: "CTA de utilidade para conteúdo checklist.",
    example: "Salva isso para revisar antes do próximo post."
  },
  {
    name: "Comenta sua versão real",
    category: "cta",
    context: ["storytelling", "humor"],
    platforms: ["instagram", "tiktok"],
    notes: "Puxa conversa com experiências parecidas.",
    example: "Comenta qual foi o erro mais bobo que já aconteceu gravando."
  },
  {
    name: "Me cobra a parte dois",
    category: "cta",
    context: ["upbeat", "lifestyle"],
    platforms: ["tiktok", "instagram"],
    notes: "Bom para séries e transformações acompanhadas.",
    example: "Me cobra a parte dois com o resultado desse teste."
  },
  {
    name: "Promessa, prova, prática",
    category: "estrutura_roteiro",
    context: ["educacional", "storytelling"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Começa com benefício, mostra evidência e termina com ação.",
    example: "Você pode melhorar seus cortes hoje. Olha o antes/depois. Faz isso no primeiro take."
  },
  {
    name: "Cena, conflito, aprendizado",
    category: "estrutura_roteiro",
    context: ["storytelling", "humor"],
    platforms: ["instagram", "tiktok"],
    notes: "Transforma bastidor simples em narrativa curta.",
    example: "Eu ia gravar um treino simples. A academia lotou. Aprendi a adaptar o roteiro."
  },
  {
    name: "Mito, realidade, ajuste",
    category: "estrutura_roteiro",
    context: ["educacional"],
    platforms: ["instagram", "tiktok", "shorts"],
    notes: "Quebra uma ideia comum e oferece uma troca prática.",
    example: "Mito: precisa postar todo dia. Realidade: precisa repetir formatos bons. Ajuste: crie uma série."
  }
];

const { error } = await supabase
  .from("library")
  .upsert(librarySeed, { onConflict: "category,name" });

if (error) throw error;

console.log(`Seed concluído: ${librarySeed.length} itens adicionados/atualizados em library.`);

function loadEnv() {
  const envPath = resolve(".env");
  if (!existsSync(envPath)) return {};

  return readFileSync(envPath, "utf8").split(/\r?\n/).reduce((env, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return env;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return env;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
    return env;
  }, {});
}
