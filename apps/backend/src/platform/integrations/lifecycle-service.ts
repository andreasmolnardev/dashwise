import {
  createIntegration,
  deleteIntegration,
  getIntegration,
  listIntegrations,
  testIntegrationEndpoint,
  updateIntegration,
} from "./internal/repository";

export interface IntegrationLifecycleAdapter {
  list: typeof listIntegrations;
  get: typeof getIntegration;
  create: typeof createIntegration;
  update: typeof updateIntegration;
  remove: typeof deleteIntegration;
  testEndpoint: typeof testIntegrationEndpoint;
}

const dataAdapter: IntegrationLifecycleAdapter = {
  list: listIntegrations,
  get: getIntegration,
  create: createIntegration,
  update: updateIntegration,
  remove: deleteIntegration,
  testEndpoint: testIntegrationEndpoint,
};

/** Platform lifecycle boundary over internal persistence. */
export class IntegrationLifecycleService {
  constructor(private readonly adapter: IntegrationLifecycleAdapter = dataAdapter) {}

  list(userId: string) {
    return this.adapter.list(userId);
  }

  get(userId: string, integrationId: string, resolveEndpoints = false) {
    return this.adapter.get(userId, integrationId, resolveEndpoints);
  }

  create(userId: string, payload: Parameters<typeof createIntegration>[1]) {
    return this.adapter.create(userId, payload);
  }

  update(
    userId: string,
    integrationId: string,
    payload: Parameters<typeof updateIntegration>[2],
  ) {
    return this.adapter.update(userId, integrationId, payload);
  }

  remove(userId: string, integrationId: string) {
    return this.adapter.remove(userId, integrationId);
  }

  testEndpoint(userId: string, target: string) {
    return this.adapter.testEndpoint(userId, target);
  }
}
