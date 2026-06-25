import { buildMetaAuthUrl, hasMetaConfig, sendJson } from "../_instagram.js";

export default function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  if (!hasMetaConfig()) {
    sendJson(response, 200, {
      status: "not_configured",
      message: "Configure META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no ambiente da Vercel."
    });
    return;
  }

  response.redirect(302, buildMetaAuthUrl());
}
