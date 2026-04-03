import SignupCard from "@/components/auth/SignupForm";
import config from "@/src/lib/config";
import { callAction } from "@/src/lib/action-client";
import { useEffect, useState } from "react";

export default function SignupPage() {
    const [disableUserSignup, setDisableUserSignup] = useState(false);


    useEffect(() => {
        (async () => {
            try {
                const data = await callAction<{ userSignupDisabled?: boolean }>("app", "getAppInfoAction")
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