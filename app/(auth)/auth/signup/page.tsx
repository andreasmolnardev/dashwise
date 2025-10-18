import SignupCard from "@/components/auth/SignupForm";
import config from "@/lib/config";

export default function LoginPage() {
    return (
        <div
            style={{ backgroundImage: `url(${config.default_bg_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            className="flex items-center justify-center min-h-screen"
        >   <SignupCard/>
        </div>
    );
}