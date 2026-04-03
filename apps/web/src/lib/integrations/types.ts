export type EndpointTestResult = {
  integration: { id: string; name: string | null };
  endpoint: {
    id: string | null;
    name: string | null;
    description: string | null;
    method: string;
    url: string;
  };
  request: { url: string; method: string; headers: Record<string, string>; body: string | null };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    parsedBody: unknown;
  };
};

export type EnvDefinition = {
  key: string;
  userHidden: boolean;
  required: boolean;
  overwriteOnly?: boolean;
  defaultValue?: string;
  description?: string;
};
