import { describe, expect, it } from "bun:test";
import { SdkResourceSubscriptions, type SdkResourceIdentity, type SdkResourceRevision } from "./sdkResourceSubscriptions";

describe("SDK resource revision subscriptions", () => {
  it("delivers revisions only to listeners for the exact instance, collection, and resource", () => {
    const subscriptions = new SdkResourceSubscriptions();
    const studyLight: SdkResourceIdentity = {
      instanceId: "homeassistant-1",
      collectionId: "entities",
      resourceId: "light.study",
    };
    const temperature: SdkResourceIdentity = {
      instanceId: "homeassistant-1",
      collectionId: "entities",
      resourceId: "sensor.temperature",
    };
    const otherInstanceLight: SdkResourceIdentity = {
      ...studyLight,
      instanceId: "homeassistant-2",
    };
    const studyRevisions: SdkResourceRevision[] = [];
    const secondStudyRevisions: SdkResourceRevision[] = [];
    const temperatureRevisions: SdkResourceRevision[] = [];
    const otherInstanceRevisions: SdkResourceRevision[] = [];
    const studySubscription = subscriptions.subscribe([studyLight], (event) => studyRevisions.push(event));
    const secondStudySubscription = subscriptions.subscribe([studyLight], (event) => secondStudyRevisions.push(event));
    const temperatureSubscription = subscriptions.subscribe([temperature], (event) => temperatureRevisions.push(event));
    const otherInstanceSubscription = subscriptions.subscribe([otherInstanceLight], (event) => otherInstanceRevisions.push(event));

    expect(studySubscription.added).toEqual([studyLight]);
    expect(secondStudySubscription.added).toEqual([]);
    expect(subscriptions.resources()).toEqual([studyLight, temperature, otherInstanceLight]);

    const update: SdkResourceRevision = { ...studyLight, revision: 2, operation: "upsert" };
    subscriptions.dispatch(update);
    expect(studyRevisions).toEqual([update]);
    expect(secondStudyRevisions).toEqual([update]);
    expect(temperatureRevisions).toEqual([]);
    expect(otherInstanceRevisions).toEqual([]);

    const removal: SdkResourceRevision = { ...otherInstanceLight, revision: 3, operation: "remove" };
    subscriptions.dispatch(removal);
    expect(otherInstanceRevisions).toEqual([removal]);
    expect(studyRevisions).toEqual([update]);

    expect(studySubscription.unsubscribe()).toEqual([]);
    const newerUpdate: SdkResourceRevision = { ...studyLight, revision: 3, operation: "upsert" };
    subscriptions.dispatch(newerUpdate);
    expect(studyRevisions).toEqual([update]);
    expect(secondStudyRevisions).toEqual([update, newerUpdate]);
    expect(secondStudySubscription.unsubscribe()).toEqual([studyLight]);
    subscriptions.dispatch({ ...studyLight, revision: 4, operation: "upsert" });
    expect(studyRevisions).toEqual([update]);
    expect(secondStudyRevisions).toEqual([update, newerUpdate]);
    expect(subscriptions.resources()).toEqual([temperature, otherInstanceLight]);

    temperatureSubscription.unsubscribe();
    otherInstanceSubscription.unsubscribe();
    expect(subscriptions.resources()).toEqual([]);
  });
});
