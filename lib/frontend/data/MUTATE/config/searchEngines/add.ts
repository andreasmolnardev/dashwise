interface AddSearchEngineOptions {
  token: string;
}

import { appendConfigArrayItemAction } from "@/app/actions/config";

/**
 * Adds a new search engine to the user configuration.
 */
export async function addSearchEngine(
  newItem: SearchEngine,
  { token }: AddSearchEngineOptions
) {
  const json = await appendConfigArrayItemAction({ token }, "searchEngines", newItem);
  return json;
}