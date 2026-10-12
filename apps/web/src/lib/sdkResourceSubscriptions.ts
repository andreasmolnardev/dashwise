export type SdkResourceIdentity = {
  instanceId: string;
  collectionId: string;
  resourceId: string;
};

export type SdkResourceRevision = SdkResourceIdentity & {
  revision: number;
  operation: "upsert" | "remove";
};

type Listener = (event: SdkResourceRevision) => void;

type Subscription = {
  resource: SdkResourceIdentity;
  listeners: Set<Listener>;
};

export function sdkResourceKey(resource: SdkResourceIdentity) {
  return JSON.stringify([resource.instanceId, resource.collectionId, resource.resourceId]);
}

/** Multiplexes resource revisions to the client listeners for that exact resource. */
export class SdkResourceSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>();

  subscribe(resources: readonly SdkResourceIdentity[], listener: Listener) {
    const uniqueResources = new Map(resources.map((resource) => [sdkResourceKey(resource), resource]));
    const added: SdkResourceIdentity[] = [];

    for (const [key, resource] of uniqueResources) {
      const subscription = this.subscriptions.get(key);
      if (subscription) {
        subscription.listeners.add(listener);
      } else {
        this.subscriptions.set(key, { resource, listeners: new Set([listener]) });
        added.push(resource);
      }
    }

    let active = true;
    return {
      added,
      unsubscribe: () => {
        if (!active) return [];
        active = false;
        const removed: SdkResourceIdentity[] = [];
        for (const [key] of uniqueResources) {
          const subscription = this.subscriptions.get(key);
          if (!subscription) continue;
          subscription.listeners.delete(listener);
          if (subscription.listeners.size === 0) {
            this.subscriptions.delete(key);
            removed.push(subscription.resource);
          }
        }
        return removed;
      },
    };
  }

  resources(): SdkResourceIdentity[] {
    return [...this.subscriptions.values()].map(({ resource }) => resource);
  }

  dispatch(event: SdkResourceRevision) {
    this.subscriptions.get(sdkResourceKey(event))?.listeners.forEach((listener) => listener(event));
  }

  clear() {
    this.subscriptions.clear();
  }
}
