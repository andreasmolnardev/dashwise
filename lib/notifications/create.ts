import {
    createNotificationWithTopicToken as createWithToken,
} from "@dashwise/sdk/data/notifications/publish";
import { resolveTopicToken as resolveToken } from "@dashwise/sdk/data/notifications/topicTokens";

export async function createNotificationWithTopicToken(topicToken: string, content: unknown) {
    const created = await createWithToken(topicToken, content);
    return created?.itemId ?? "";
}

export async function resolveTopicToken(token: string) {
    const resolved = await resolveToken(token);
    return resolved?.topicId ?? "";
}