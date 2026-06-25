export async function loadInstagramDashboard() {
  const response = await fetch("/api/instagram/dashboard", {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Não foi possível carregar os insights do Instagram.");
  }

  return response.json();
}

export async function syncInstagramInsights() {
  const response = await fetch("/api/instagram/sync", {
    method: "POST",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Não foi possível iniciar a sincronização do Instagram.");
  }

  return response.json();
}
