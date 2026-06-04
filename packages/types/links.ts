import type { HomeLink as SdkHomeLink } from "./sdk-types";

export type StatusCheckMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type StatusCheckAuth =
  | { type: "bearer"; token?: string }
  | { type: "basic"; username?: string; password?: string }
  | { type: "header"; name?: string; value?: string };

export type HomeLink = SdkHomeLink;

export type LinkType = Partial<HomeLink> & {
  icon?: string;
  linkGroup?: string;
  folder?: string;
  name?: string;
  statusCheck?: boolean;
  statusCheckEndpoint?: string;
  statusCheckMethod?: StatusCheckMethod;
  statusCheckAuth?: StatusCheckAuth;
  statusCheckShowAsUp?: number[];
};