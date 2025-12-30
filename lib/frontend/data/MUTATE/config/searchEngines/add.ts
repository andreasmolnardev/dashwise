interface AddSearchEngineOptions {
  token: string;
}

/**
 * Adds a new search engine to the user configuration.
 */
export async function addSearchEngine(
  newItem: SearchEngine,
  { token }: AddSearchEngineOptions
) {
  const res = await fetch(`/api/v1/config?path=searchEngines`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ newItem }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Request failed with status ${res.status}`);
  }

  return await res.json();
}