"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  //check if authed, then load config, then redirect to default page or 
  const router = useRouter();
  useEffect(() => {
    router.replace("/auth");
  }, [router]);
  return null;
}
