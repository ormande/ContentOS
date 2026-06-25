import { handleCallback } from "../_instagram.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Método não permitido." });
    return;
  }

  await handleCallback(request, response);
}
