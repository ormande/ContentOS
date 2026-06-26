export async function handleAiGenerate(request, response, options = {}) {
  const body = options.body || await readJsonBody(request);
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;

  if (request.method && request.method !== "POST") {
    sendJson(response, 405, { error: "Método não permitido." });
    return;
  }

  if (!apiKey) {
    sendJson(response, 500, { error: "GEMINI_API_KEY não configurada no backend." });
    return;
  }

  if (!body?.type || !body?.data) {
    sendJson(response, 400, { error: "Payload inválido. Envie type e data." });
    return;
  }

  const payload = buildGeminiPayload(body.type, body.data);
  if (!payload) {
    sendJson(response, 400, { error: "Tipo de geração não suportado." });
    return;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${encodeURIComponent(apiKey)}`;
  const upstream = await fetch(`${endpoint}&alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text().catch(() => "");
    sendJson(response, upstream.status || 502, {
      error: "Falha ao gerar conteúdo com Gemini.",
      detail: errorText
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Transfer-Encoding": "chunked"
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const textChunk = extractTextFromSseEvent(rawEvent);
      if (textChunk) {
        response.write(textChunk);
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) {
    const trailingChunk = extractTextFromSseEvent(buffer);
    if (trailingChunk) {
      response.write(trailingChunk);
    }
  }

  response.end();
}

export function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export async function readJsonBody(request) {
  if (!request?.body) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
  }

  if (typeof request.body === "object") {
    return request.body;
  }

  const rawBody = typeof request.body === "string" ? request.body : String(request.body || "");
  return rawBody ? JSON.parse(rawBody) : {};
}

function extractTextFromSseEvent(rawEvent) {
  const dataLines = rawEvent
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trim())
    .filter(Boolean);

  if (!dataLines.length) return "";

  let combined = "";
  for (const line of dataLines) {
    if (line === "[DONE]") continue;
    try {
      const json = JSON.parse(line);
      combined += extractTextFromGeminiChunk(json);
    } catch {
      combined += line;
    }
  }

  return combined;
}

function extractTextFromGeminiChunk(json) {
  return (json?.candidates || [])
    .flatMap(candidate => candidate?.content?.parts || [])
    .map(part => part?.text || "")
    .join("");
}

function buildGeminiPayload(type, data) {
  const prompt = buildPrompt(type, data);
  if (!prompt) return null;

  return {
    systemInstruction: {
      parts: [{
        text: prompt.system
      }]
    },
    contents: [{
      role: "user",
      parts: [{
        text: prompt.user
      }]
    }],
    generationConfig: {
      temperature: prompt.temperature ?? 0.7,
      responseMimeType: "application/json"
    }
  };
}

function buildPrompt(type, data) {
  if (type === "script") {
    return {
      temperature: 0.8,
      system: [
        "Você é um roteirista de vídeos curtos para Instagram, TikTok e YouTube Shorts.",
        "Responda somente em JSON válido.",
        "Preencha fields com as chaves informadas em structure.fields (use field.key como chave no JSON).",
        "Para tutorial, steps deve ser array de strings numeradas.",
        "Respeite tone (serio, normal, humor) e scene_format (numeradas = cenas numeradas no script_text; continuo = narrativa fluida sem numeração).",
        "Recomende gancho, formato e CTAs exclusivamente a partir de library.hooks, library.formats e library.ctas.",
        "Quando houver hookType nos ganchos, considere visual vs textual na recomendação.",
        "Quando houver métricas (views, reach, saves, shares, likes, uses), priorize itens com melhor desempenho.",
        "Formato obrigatório:",
        '{"script_text":"string","fields":{},"suggested_hook":{"id":"string","name":"string","reason":"string"},"suggested_format":{"id":"string","name":"string","reason":"string"},"suggested_ctas":[{"id":"string","name":"string","reason":"string"}],"text_headers":[{"label":"string","moment":"string"}],"header_recommendation":"string"}'
      ].join(" "),
      user: JSON.stringify({
        task: "Gerar roteiro completo seguindo a estrutura informada e recomendar gancho, formato e CTAs da biblioteca.",
        template: data.template,
        structure: data.structure,
        fields: data.fields,
        title: data.title,
        objective: data.objective,
        idea: data.idea,
        tone: data.tone || "normal",
        scene_format: data.scene_format || "numeradas",
        library: data.library || {}
      })
    };
  }

  if (type === "caption") {
    return {
      temperature: 0.8,
      system: [
        "Você é especialista em copy para vídeos curtos e legendas de redes sociais.",
        "Responda somente em JSON válido.",
        "Instagram e TikTok devem ser um único texto por plataforma, com título, corpo e hashtags separados por linha em branco (não use campos separados).",
        "Use no máximo 5 hashtags por plataforma, preferencialmente uma palavra cada.",
        "YouTube Shorts usa 3 campos: title (até 100 caracteres, SEO + hashtags), description (até 5000 caracteres sobre o vídeo) e tags (até 500 caracteres com palavras-chave separadas por vírgula).",
        "Respeite tone.emojis (sem, pouco, normal, muito), tone.enthusiasm (baixo, moderado, alto) e tone.voice (casual, neutro, direto).",
        "Formato obrigatório:",
        '{"instagram":"string","tiktok":"string","youtube":{"title":"string","description":"string","tags":"string"}}'
      ].join(" "),
      user: JSON.stringify({
        task: "Gerar legendas unificadas por conteúdo para as plataformas solicitadas.",
        title: data.title,
        script: data.script,
        objective: data.objective,
        platforms: data.platforms,
        tone: data.tone || {},
        hashtags: data.hashtags,
        seo_terms: data.seo_terms
      })
    };
  }

  if (type === "cta") {
    return {
      temperature: 0.5,
      system: [
        "Você sugere CTAs para vídeos curtos.",
        "Responda somente em JSON válido.",
        "Formato obrigatório:",
        '{"selected":[{"name":"string","reason":"string"}]}'
      ].join(" "),
      user: JSON.stringify({
        task: "Escolher os CTAs mais adequados para o objetivo.",
        objective: data.objective,
        cta_options: data.cta_options
      })
    };
  }

  if (type === "text_headers") {
    return {
      temperature: 0.7,
      system: [
        "Você sugere headers curtos para vídeos curtos.",
        "Responda somente em JSON válido.",
        "Formato obrigatório:",
        '{"header_recommendation":"string","headers":[{"label":"string","moment":"string"}]}'
      ].join(" "),
      user: JSON.stringify({
        task: "Sugerir headers de texto e informar o momento aproximado de uso.",
        script: data.script
      })
    };
  }

  if (type === "improve") {
    return {
      temperature: 0.7,
      system: [
        "Você melhora conteúdo existente para vídeos curtos.",
        "Responda somente em JSON válido.",
        "Se type for script, use o formato:",
        '{"script_text":"string","fields":{},"suggested_hook":{"id":"string","name":"string","reason":"string"},"suggested_format":{"id":"string","name":"string","reason":"string"},"suggested_ctas":[{"id":"string","name":"string","reason":"string"}],"text_headers":[{"label":"string","moment":"string"}],"header_recommendation":"string"}',
        "Preencha fields com as chaves de content.structure.fields.",
        "Respeite context.tone e context.scene_format ao reescrever.",
        "Recomende gancho, formato e CTAs somente a partir de context.library, priorizando melhores métricas quando existirem.",
        "Se type for caption, use o formato:",
        '{"title":"string","body":"string","hashtags":["#tag"],"seo_terms":["termo"],"yt_title":"string","yt_description":"string","yt_tags":"tag1, tag2"}'
      ].join(" "),
      user: JSON.stringify({
        task: "Melhorar o conteúdo atual com base no contexto.",
        type: data.type,
        content: data.content,
        context: data.context
      })
    };
  }

  return null;
}
