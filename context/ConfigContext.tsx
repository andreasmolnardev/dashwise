import { createContext, useContext, ReactNode } from "react";

type ConfigContextType = {
  config: any;
  refreshConfig: () => Promise<void>;
};

export const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const useConfig = () => {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used inside ConfigProvider");
  return ctx;
};

export const ConfigProvider = ({ children, value }: { children: ReactNode; value: ConfigContextType }) => {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};
