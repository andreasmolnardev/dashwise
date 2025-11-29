import { getSuperuserPB } from "../pb";

export async function createNotificationWithTopicToken(topicToken, content) {
    const topicId = await resolveTopicToken(topicToken);
    if (!topicId) {
        return "";
    }

    const _pocketbase = await getSuperuserPB();

    const createdItem = await _pocketbase.collection("notificationItems").create({
        topicId,
        content: content,
        status: "sent",
        source: "token",
    });

    return createdItem.id
}

/**
 * Get a topicId by topicToken
 * @param token 
 * @returns NotificationTopicId
 */
export async function resolveTopicToken(token) {
    // Lookup token in notificationTopicTokens using superuser
    const _pocketbase = await getSuperuserPB();

    let tokenRecord: any = null;
    try {
        tokenRecord = await _pocketbase
            .collection("notificationTopicTokens")
            .getFirstListItem(`token="${token}"`);
    } catch {
        return "";
    }

    //Check expiration, resolve topic, create notification (same as before)
    if (tokenRecord.expires) {
        const exp = new Date(tokenRecord.expires);
        if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
            return "";
        }
    }

    const topicId = tokenRecord.topic ?? tokenRecord.topicId ?? tokenRecord.topic?.id;
    if (!topicId) {
        return "";
    }

    return topicId;
}