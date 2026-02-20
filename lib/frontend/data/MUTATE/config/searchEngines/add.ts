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
  const { post } = await import("@/lib/apiClient");
  const json = await post(`/config?path=searchEngines`, { newItem }, { token });
  if (json?.error) throw new Error(json.error || "Request failed");
  return json;
}