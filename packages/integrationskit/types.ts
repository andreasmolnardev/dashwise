export type ResolvedEndpointData = {
  id: string | null;
  name: string | null;
  method: string;
  url: string;
  resolvedUrl: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  rawResponse: unknown;
  mappedResponse: unknown;
};

export type EndpointRuntimeCacheAdapter = {
  get: (endpointId: string) => ResolvedEndpointData | null;
  set: (
    endpointId: string,
    payload: ResolvedEndpointData,
    expiresAt: number | null,
  ) => void;
};

export type ResolvedWidget = {
  header?: {
    title?: string;
    icon?: string;
    titleAction?: string;
    /** false when show_if evaluated to false */
    show?: boolean;
  };
  /** Optional widget-level customization flags declared by the YAML */
  user_customizations?: Array<"allow_reorder" | "allow_hide">;
  /** Populated for template: "columns" */
  columns?: ResolvedColumn[];
  /** Populated for template: "vertical-list" */
  list?: ResolvedListItem[];
  /** Populated for template: "icon-details-card" */
  card?: {
    icon?: string;
    primary?: string;
    secondary?: string;
  };
  /** Populated for template: "iframe" */
  iframe?: {
    url?: string;
    minHeight?: number;
    maxHeight?: number;
  };
  /** The raw properties object, passed through for custom consumers */
  raw: Record<string, any>;
  progress?: number | null;
};

export type ResolvedColumn = {
  id: string;
  label?: string;
  icon?: {
    type?: string;
    file?: string;
    size?: number;
    description?: string;
    useFrostedGradient?: boolean;
  };
  primary?: string;
  primaryAction?: string;
  secondary?: string;
  stats?: {
    primary?: string;
    secondary?: string;
  };
  progress?: {
    type?: string;
    value?: number;
    thresholds?: Array<{ min: number; color: string }>;
    zero_label?: string;
  };
  title?: string;
  titleAction?: string;
  badge?: { show?: boolean; icon?: string; tooltip?: string };
  thumbnail?: string;
};

export type ResolvedIcon = {
  source?: string;
  useFrostedGradient?: boolean;
};

export type ResolvedListItem = {
  accent?: string;
  icon?: string;
  title?: string;
  titleAction?: string;
  subtitle?: string | string[];
  thumbnail?: string;
  badge?: { show?: boolean; icon?: string; tooltip?: string };
  group?: string;
};

export type ResolveOptions = {
  widgetJSON: Record<string, any>;
  integrationJSON: Record<string, any> | null;
  data: Record<string, any> | null;
  isPreview: boolean;
  endpointCache?: EndpointRuntimeCacheAdapter;
  allowInsecureEndpoints?: boolean;
};

export type RuntimeDataResolution = {
  data: Record<string, any> | null;
  env: Record<string, string>;
};

export type IntegrationRuntimeProperties = {
  endpoints: Record<string, ResolvedEndpointData>;
  computed: Record<string, any>;
  lookup_tables?: Record<string, any>;
  env: Record<string, string>;
};
