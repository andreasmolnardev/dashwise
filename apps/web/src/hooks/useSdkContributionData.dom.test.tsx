import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Window } from "happy-dom";
import React from "react";

type ResourceEvent = {
  instanceId: string;
  collectionId: string;
  resourceId: string;
  revision: number;
  operation: "upsert" | "remove";
};

const targetResource = {
  instanceId: "ha-instance",
  collectionId: "entities",
  resourceId: "light.office",
};

let currentValue = "on";
let revision = 4;
let apiCalls = 0;
let resourcesForConfig: Record<string, unknown>[] = [];
let contributionData: Record<string, unknown> = { state: currentValue };
let instancesForManager: Record<string, unknown>[] = [];
let createdInstancePayload: Record<string, unknown> | null = null;
const homeAssistantCatalogEntry = {
  id: "homeassistant",
  name: "Home Assistant",
  version: "1.0.0",
  description: "Discover and control Home Assistant entities.",
  config: {
    url: { type: "url", title: "Home Assistant URL", required: true },
    accessToken: { type: "secret", title: "Long-lived access token", required: true },
  },
};
const widgetContribution = {
  id: "health-summary",
  template: "icon-details-card",
  properties: {
    header: { title: "${endpoint.name}", icon: "mdi:server" },
    icon: { file: "${endpoint.icon}", size: 32, description: "Service status" },
    primary: "${endpoint.state}",
    secondary: "HTTP ${endpoint.attributes.statusCode}",
  },
  configSchema: { properties: { endpoint: { type: "shortcut-select" } } },
};
const glanceableContribution = {
  id: "health-state",
  text: "${endpoint.state}",
  columns: [{ text: "${endpoint.state}" }],
  configSchema: { properties: { endpoint: { type: "shortcut-select" } } },
};
const subscriptions = new Set<{
  resources: typeof targetResource[];
  listener: (event: ResourceEvent) => void;
}>();

const withAuth = async <T,>(callback: (auth: Record<string, never>) => Promise<T> | T) => callback({});
const resolveSdkContributionAction = mock(async () => {
  apiCalls += 1;
  return {
    data: contributionData,
    revisions: [{
      collectionId: targetResource.collectionId,
      resourceId: targetResource.resourceId,
      revision,
    }],
  };
});
const getSdkIntegrationResourcesAction = mock(async () => resourcesForConfig);
const getSdkContributionDefinitionAction = mock(async (_auth: unknown, _instanceId: string, kind: string) =>
  kind === "widget" ? widgetContribution : glanceableContribution,
);
const getSdkIntegrationCatalogAction = mock(async () => [homeAssistantCatalogEntry]);
const getSdkIntegrationInstancesAction = mock(async () => instancesForManager);
const getSdkIntegrationInstanceStatusAction = mock(async () => ({ state: "connected", message: "Connected" }));
const createSdkIntegrationInstanceAction = mock(async (_auth: unknown, payload: Record<string, unknown>) => {
  createdInstancePayload = payload;
  instancesForManager = [{
    id: "ha-instance-created",
    source: "homeassistant",
    name: payload.name,
    config: payload.config,
    configuredSecrets: ["accessToken"],
    enabled: true,
  }];
  return instancesForManager[0];
});
const updateSdkIntegrationInstanceAction = mock(async () => ({}));
const deleteSdkIntegrationInstanceAction = mock(async () => ({}));
const testSdkIntegrationConnectionAction = mock(async () => ({ success: true, status: { state: "connected" } }));

function subscribeSdkResources(
  resources: typeof targetResource[],
  listener: (event: ResourceEvent) => void,
) {
  const subscription = { resources, listener };
  subscriptions.add(subscription);
  return () => subscriptions.delete(subscription);
}

function emitResourceEvent(event: ResourceEvent) {
  for (const subscription of subscriptions) {
    if (subscription.resources.some((resource) =>
      resource.instanceId === event.instanceId
      && resource.collectionId === event.collectionId
      && resource.resourceId === event.resourceId
    )) {
      subscription.listener(event);
    }
  }
}

mock.module("../context/useAuth", () => ({
  default: () => ({ withAuth }),
}));
mock.module("../context/ActivityContext", () => ({
  useActivity: () => ({ subscribeSdkResources }),
}));
mock.module("../lib/apiClient", () => ({
  createSdkIntegrationInstanceAction,
  deleteSdkIntegrationInstanceAction,
  getSdkContributionDefinitionAction,
  getSdkIntegrationCatalogAction,
  getSdkIntegrationInstanceStatusAction,
  getSdkIntegrationInstancesAction,
  getSdkIntegrationResourcesAction,
  resolveSdkContributionAction,
  testSdkIntegrationConnectionAction,
  updateSdkIntegrationInstanceAction,
}));

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let createRoot: typeof import("react-dom/client").createRoot;
let act: typeof import("react").act;
let useSdkContributionData: typeof import("./useSdkContributionData").useSdkContributionData;
let SdkContributionConfigForm: typeof import("../components/settings/integrations/SdkContributionConfigForm").default;
let SdkIntegrationWidget: typeof import("../components/widgets/SdkIntegrationContribution").SdkIntegrationWidget;
let SdkIntegrationGlanceable: typeof import("../components/widgets/SdkIntegrationContribution").SdkIntegrationGlanceable;
let SdkIntegrationsManager: typeof import("../components/settings/integrations/SdkIntegrationsManager").default;

beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    FocusEvent: dom.FocusEvent,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  ({ createRoot } = await import("react-dom/client"));
  ({ act } = await import("react"));
  ({ useSdkContributionData } = await import("./useSdkContributionData"));
  ({ default: SdkContributionConfigForm } = await import("../components/settings/integrations/SdkContributionConfigForm"));
  ({ SdkIntegrationWidget, SdkIntegrationGlanceable } = await import("../components/widgets/SdkIntegrationContribution"));
  ({ default: SdkIntegrationsManager } = await import("../components/settings/integrations/SdkIntegrationsManager"));
}, 30_000);

afterAll(() => {
  dom.happyDOM.abort();
  dom.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("useSdkContributionData in a mounted client component", () => {
  it("resolves its initial data, refreshes only for newer revisions of selected resources, and unsubscribes on unmount", async () => {
    currentValue = "on";
    revision = 4;
    contributionData = { state: currentValue };
    apiCalls = 0;
    subscriptions.clear();
    resolveSdkContributionAction.mockClear();

    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    let root: ReturnType<typeof createRoot>;

    function Probe() {
      const result = useSdkContributionData({
        instanceId: targetResource.instanceId,
        kind: "widget",
        contributionId: "entity-state",
        config: { entityId: targetResource.resourceId },
      });
      return React.createElement("output", null, String(result.data?.state ?? result.error ?? "loading"));
    }

    await act(async () => {
      root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
      root.render(React.createElement(Probe));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("on");
    expect(apiCalls).toBe(1);
    expect([...subscriptions][0]?.resources).toEqual([targetResource]);

    await act(async () => {
      currentValue = "off";
      revision = 5;
      contributionData = { state: currentValue };
      emitResourceEvent({ ...targetResource, revision: 5, operation: "upsert" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("off");
    expect(apiCalls).toBe(2);

    await act(async () => {
      emitResourceEvent({ ...targetResource, revision: 5, operation: "upsert" });
      emitResourceEvent({ ...targetResource, revision: 3, operation: "upsert" });
      emitResourceEvent({
        ...targetResource,
        resourceId: "sensor.unselected",
        revision: 99,
        operation: "upsert",
      });
      await Promise.resolve();
    });

    expect(apiCalls).toBe(2);

    await act(async () => root.unmount());
    expect(subscriptions.size).toBe(0);
    dom.document.body.removeChild(container);
  });

  it("loads selectable SDK shortcuts into contribution configuration and saves selected resource IDs", async () => {
    subscriptions.clear();
    resourcesForConfig = [
      { id: "light.office", name: "Office light", collectionId: "entities", apps: ["lights"], available: true },
      { id: "sensor.office", name: "Office temperature", collectionId: "entities", apps: ["sensors"], available: true },
      { id: "light.retired", name: "Retired light", collectionId: "entities", apps: ["lights"], available: false },
      { id: "feed.news", name: "News feed", collectionId: "feeds", apps: ["news"], available: true },
    ];
    getSdkIntegrationResourcesAction.mockClear();

    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    const changes: Record<string, unknown>[] = [];
    let root: ReturnType<typeof createRoot>;

    await act(async () => {
      root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
      root.render(React.createElement(SdkContributionConfigForm, {
        instanceId: targetResource.instanceId,
        schema: {
          entityIds: {
            type: "shortcut-select",
            multiple: true,
            collectionIds: ["entities"],
            label: "Entities",
          },
        },
        value: { entityIds: [] },
        onChange: (next: Record<string, unknown>) => changes.push(next),
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getSdkIntegrationResourcesAction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Office light");
    expect(container.textContent).toContain("Office temperature");
    expect(container.textContent).not.toContain("Retired light");
    expect(container.textContent).not.toContain("News feed");
    const selectable = container.querySelectorAll('input[type="checkbox"]');
    expect(selectable).toHaveLength(2);

    await act(async () => {
      (selectable[0] as unknown as HTMLInputElement).click();
    });

    expect(changes.at(-1)).toEqual({ entityIds: ["light.office"] });
    await act(async () => root.unmount());
    dom.document.body.removeChild(container);
  });

  it("renders the REST SDK Widget and Glanceable and refreshes both when their resource changes", async () => {
    revision = 10;
    contributionData = {
      endpoint: {
        name: "REST example",
        icon: "mdi:server-network",
        state: "online",
        attributes: { statusCode: 200 },
      },
    };
    apiCalls = 0;
    subscriptions.clear();
    resolveSdkContributionAction.mockClear();
    getSdkContributionDefinitionAction.mockClear();

    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    let root: ReturnType<typeof createRoot>;
    const address = {
      instanceId: targetResource.instanceId,
      contributionId: "health-summary",
    };

    await act(async () => {
      root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
      root.render(React.createElement(React.Fragment, null,
        React.createElement(SdkIntegrationWidget, {
          address: { ...address, kind: "widget" },
          config: { endpoint: "endpoint" },
        }),
        React.createElement(SdkIntegrationGlanceable, {
          address: { ...address, kind: "glanceable", contributionId: "health-state" },
          config: { endpoint: "endpoint" },
        }),
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getSdkContributionDefinitionAction).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("REST example");
    expect(container.textContent).toContain("online");
    expect(container.textContent).toContain("HTTP 200");
    expect(subscriptions.size).toBe(2);

    await act(async () => {
      contributionData = {
        endpoint: {
          name: "REST example",
          icon: "mdi:server-network",
          state: "offline",
          attributes: { statusCode: 503 },
        },
      };
      revision = 11;
      emitResourceEvent({ ...targetResource, revision, operation: "upsert" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("offline");
    expect(container.textContent).toContain("HTTP 503");
    expect(apiCalls).toBe(4);

    await act(async () => root.unmount());
    expect(subscriptions.size).toBe(0);
    dom.document.body.removeChild(container);
  });

  it("installs a Home Assistant instance from the integrations settings form", async () => {
    instancesForManager = [];
    createdInstancePayload = null;
    getSdkIntegrationCatalogAction.mockClear();
    getSdkIntegrationInstancesAction.mockClear();
    createSdkIntegrationInstanceAction.mockClear();

    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    let root: ReturnType<typeof createRoot>;

    await act(async () => {
      root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
      root.render(React.createElement(SdkIntegrationsManager));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Home Assistant");
    expect(getSdkIntegrationCatalogAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Install"))
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const nameInput = dom.document.body.querySelector("#sdk-instance-name") as unknown as HTMLInputElement;
    const urlInput = dom.document.body.querySelector("#sdk-config-url") as unknown as HTMLInputElement;
    const tokenInput = dom.document.body.querySelector("#sdk-config-accessToken") as unknown as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(urlInput).not.toBeNull();
    expect(tokenInput).not.toBeNull();

    await act(async () => {
      const setValue = (input: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        input.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
      };
      setValue(nameInput, "Living Room");
      setValue(urlInput, "http://homeassistant.local:8123");
      setValue(tokenInput, "ha-test-secret");
      [...(dom.document.body.querySelector('[role="dialog"]')?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent?.trim() === "Install")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createSdkIntegrationInstanceAction).toHaveBeenCalledTimes(1);
    expect(createdInstancePayload as unknown).toEqual({
      source: "homeassistant",
      name: "Living Room",
      config: { url: "http://homeassistant.local:8123", accessToken: "ha-test-secret" },
    });
    expect(container.textContent).toContain("Living Room");

    await act(async () => root.unmount());
    dom.document.body.removeChild(container);
  });
});
