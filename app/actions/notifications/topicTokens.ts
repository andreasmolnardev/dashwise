"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import {
  createTopicToken,
  deleteTopicToken,
  listTopicTokens,
} from "@/lib/api/data/notifications/topicTokens";

export async function listTopicTokensAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return listTopicTokens(userId);
}

export async function createTopicTokenAction(auth: ActionAuth, body: any) {
  const { userId } = await requireUserAuth(auth);
  return createTopicToken(userId, body);
}

export async function deleteTopicTokenAction(auth: ActionAuth, tokenId: string) {
  const { userId } = await requireUserAuth(auth);
  return deleteTopicToken(userId, tokenId);
}
