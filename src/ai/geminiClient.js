export async function streamGenerate({ type, data, onChunk, onDone, onError }) {
  try {
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain"
      },
      body: JSON.stringify({ type, data })
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || "Não foi possível gerar conteúdo com a IA.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      fullText += chunk;
      onChunk?.(chunk, fullText);
    }

    onDone?.(fullText);
    return fullText;
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error("Erro inesperado na geração."));
    throw error;
  }
}
