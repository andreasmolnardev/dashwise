"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import useAuth from "@/context/useAuth";

type AuthWrapperProps = {
  children: ReactNode;
};

export default function AuthWrapper({ children }: AuthWrapperProps) {
  const router = useRouter();
  const { token } = useAuth();

  useEffect(() => {
    if (!token) {
      router.replace("/auth/login");
    }
  }, [router, token]);

  if (!token) {
    return null;
  }

  return <>{children}</>;
}
