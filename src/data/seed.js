import { applyLibrarySeedIfEmpty } from "./librarySeed.js";

const result = applyLibrarySeedIfEmpty({
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
  console.log(`Seed da biblioteca: ${result.state.library.length} itens criados (somente em memória; use o app com Supabase para persistir).`);
} else {
  console.log("Biblioteca já possui itens. Seed ignorado.");
}
