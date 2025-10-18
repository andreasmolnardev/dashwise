import { createContext, useContext } from "react";

interface BlurContextType {
  blurClass: string;
  setBackgroundBlur: (className: string) => void;
}

export const BlurContext = createContext<BlurContextType | null>(null);

export const useBlur = () => {
  const context = useContext(BlurContext);
  if (!context) throw new Error("useBlur must be used within a BlurProvider");
  return context;
};
