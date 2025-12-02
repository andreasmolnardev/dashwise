import SignupCard from "@/components/auth/SignupForm";
import config from "@/lib/config";

export default function SignupPage() {
    if (config.disableUserSignup) {
        return (<div className="flex items-center justify-center min-h-screen">Signup has been disabled by the admin</div>)
    }
    return (
        <div
            style={{ backgroundImage: `url(${config.default_bg_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            className="flex items-center justify-center min-h-screen"
        >   <SignupCard/>
        </div>
    );
}