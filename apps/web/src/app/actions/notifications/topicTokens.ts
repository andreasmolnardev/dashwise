import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function listTopicTokensAction(auth: ActionAuth) {
  return api.notifications.topicTokens.listTopicTokensAction(auth);
}

export async function createTopicTokenAction(auth: ActionAuth, body: any) {
  return api.notifications.topicTokens.createTopicTokenAction({ auth, body });
}

export async function deleteTopicTokenAction(auth: ActionAuth, tokenId: string) {
  return api.notifications.topicTokens.deleteTopicTokenAction({ auth, tokenId });
}
