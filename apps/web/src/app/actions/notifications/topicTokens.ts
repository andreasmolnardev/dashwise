import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function listTopicTokensAction(auth: ActionAuth) {
  return api.notifications.topicTokens.listTopicTokensAction.query(auth);
}

export async function createTopicTokenAction(auth: ActionAuth, body: any) {
  return api.notifications.topicTokens.createTopicTokenAction.mutate({ auth, body });
}

export async function deleteTopicTokenAction(auth: ActionAuth, tokenId: string) {
  return api.notifications.topicTokens.deleteTopicTokenAction.mutate({ auth, tokenId });
}
