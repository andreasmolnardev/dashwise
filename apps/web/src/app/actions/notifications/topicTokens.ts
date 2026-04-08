import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function listTopicTokensAction(auth: ActionAuth) {
  return callApiAction("notifications.topicTokens", "listTopicTokensAction", auth);
}

export async function createTopicTokenAction(auth: ActionAuth, body: any) {
  return callApiAction("notifications.topicTokens", "createTopicTokenAction", { auth, body });
}

export async function deleteTopicTokenAction(auth: ActionAuth, tokenId: string) {
  return callApiAction("notifications.topicTokens", "deleteTopicTokenAction", { auth, tokenId });
}
