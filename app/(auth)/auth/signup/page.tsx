"use client";
import SignupCard from "@/components/auth/SignupForm";
import config from "@/lib/config";
import readEndpoint from "@/lib/frontend/data/GET/readEndpoint";
import { useEffect, useState } from "react";

export default function SignupPage() {
    const [disableUserSignup, setDisableUserSignup] = useState(false);


    useEffect(() => {
        let mounted = true;
        const ctl = new AbortController();

        (async () => {
            try {
                const data = await readEndpoint<{ disableUserSignup?: boolean }>("/appInfo", {
                    signal: ctl.signal,
                });
                if (!mounted) return;
                if (data?.disableUserSignup) setDisableUserSignup(true);
            } catch (err) {
                console.error("Update check failed:", err);
            }
        })();

        return () => {
            mounted = false;
            ctl.abort();
        };
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