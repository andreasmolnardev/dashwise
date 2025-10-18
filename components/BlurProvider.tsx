"use client";

import { ReactNode, useState, useCallback } from "react";
import { BlurContext } from "@/context/BlurContext";

export default function BlurProvider({ children }: { children: ReactNode }) {
  const [blurClass, setBlurClass] = useState("backdrop-blur-[3px]");

  const setBackgroundBlur = useCallback((className: string) => {
    setBlurClass(className);
  }, []);

  return (
    <BlurContext.Provider value={{ blurClass, setBackgroundBlur }}>
      <div className={`min-h-screen backdrop-brightness-85 ${blurClass}`}>
        {children}
      </div>
    </BlurContext.Provider>
  );
}
