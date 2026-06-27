import { applyLibrarySeed } from "./librarySeed.js";

const result = applyLibrarySeed({
  ideas: [],
  pieces: [],
  scripts: [],
  pieceComponents: [],
  texts: [],
  files: [],
  publications: [],
  library: [],
  ai: { enabled: true, provider: "local", plannedHooks: [] }
});

if (result.seeded) {
  console.log(`Seed da biblioteca: ${result.state.library.length} itens disponiveis apos complementar os padroes ausentes (somente em memoria; use o app com Supabase para persistir).`);
} else {
  console.log("Biblioteca ja estava completa para os itens padrao.");
}
