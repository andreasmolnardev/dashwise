"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

type StreamPhase = "idle" | "streaming" | "complete" | "error";

type PageIntegrationStreamState = {
  phase: StreamPhase;
  version: number;
  pageName?: string;
};

const PageIntegrationStreamContext = createContext<PageIntegrationStreamState>({
  phase: "idle",
  version: 0,
});

export function PageIntegrationStreamProvider({
  value,
  children,
}: {
  value: PageIntegrationStreamState;
  children: ReactNode;
}) {
  return (
    <PageIntegrationStreamContext.Provider value={value}>
      {children}
    </PageIntegrationStreamContext.Provider>
  );
}

export function usePageIntegrationStream() {
  return useContext(PageIntegrationStreamContext);
}
