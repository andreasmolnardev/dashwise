type ActivitySubscriber = () => Promise<void>;

const subscribers = new Map<string, Set<ActivitySubscriber>>();

export function subscribeActivity(userId: string, subscriber: ActivitySubscriber) {
  const userSubscribers = subscribers.get(userId) ?? new Set<ActivitySubscriber>();
  userSubscribers.add(subscriber);
  subscribers.set(userId, userSubscribers);

  return () => {
    userSubscribers.delete(subscriber);
    if (userSubscribers.size === 0) subscribers.delete(userId);
  };
}

export function broadcastActivity(userId: string) {
  for (const subscriber of subscribers.get(userId) ?? []) {
    void subscriber().catch(() => undefined);
  }
}
