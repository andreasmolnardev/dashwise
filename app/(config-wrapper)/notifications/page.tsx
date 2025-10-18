"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SettingsRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/notifications/inbox"); 
    }, [router]);

    return null;

}