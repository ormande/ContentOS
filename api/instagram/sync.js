import { handleSync, sendJson } from "../_instagram.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  await handleSync(response);
}
