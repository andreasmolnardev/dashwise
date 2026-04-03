import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function listTopicTokensAction(auth: ActionAuth) {
  return callAction("notifications/topicTokens", "listTopicTokensAction", [auth]);
}

export async function createTopicTokenAction(auth: ActionAuth, body: any) {
  return callAction("notifications/topicTokens", "createTopicTokenAction", [auth, body]);
}

export async function deleteTopicTokenAction(auth: ActionAuth, tokenId: string) {
  return callAction("notifications/topicTokens", "deleteTopicTokenAction", [auth, tokenId]);
}
