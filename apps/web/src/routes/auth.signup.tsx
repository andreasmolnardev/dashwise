import SignupCard from "@/components/auth/SignupForm";
import { createFileRoute } from "@tanstack/react-router";
import { getAppInfoAction } from '@/lib/apiClient';
import config from "@/lib/config";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/auth/signup")({ component: SignupPage });

export default function SignupPage() {
    const [disableUserSignup, setDisableUserSignup] = useState(false);


    useEffect(() => {
        (async () => {
            try {
                const data = await getAppInfoAction();
                if (data?.userSignupDisabled) setDisableUserSignup(true);
            } catch (err) {
                console.error("Update check failed:", err);
            }
        })();

        return undefined;
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
