"use client";
import SignupCard from "@/components/auth/SignupForm";
import config from "@/lib/config";
import { useEffect, useState } from "react";

export default function SignupPage() {
    const [disableUserSignup, setDisableUserSignup] = useState(false);

    useEffect(() => {
        async function fetchUpdateInfo() {
            try {
                const res = await fetch("/api/v1/appInfo");
                if (!res.ok) throw new Error("Failed to fetch update info");
                const data = await res.json();

                if (data.disableUserSignup) {
                    setDisableUserSignup(true);
                }
            } catch (err) {
                console.error("Update check failed:", err);
            }
        }

        fetchUpdateInfo();
    }, []);
    
    if (disableUserSignup) {
        return (<div className="flex items-center justify-center min-h-screen">Signup has been disabled by the admin</div>)
    }
    return (
        <div
            style={{ backgroundImage: `url(${config.default_bg_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            className="flex items-center justify-center min-h-screen"
        >   <SignupCard />
        </div>
    );
}