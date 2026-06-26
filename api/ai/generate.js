import { handleAiGenerate, readJsonBody, sendJson } from "../_ai.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  const body = await readJsonBody(request);
  await handleAiGenerate(request, response, {
    body,
    apiKey: process.env.GEMINI_API_KEY
  });
}
