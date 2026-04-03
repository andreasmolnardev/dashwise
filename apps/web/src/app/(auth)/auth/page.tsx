import AuthWelcomeFormComponent from "@/components/auth/AuthWelcomeForm";
import config from "@/src/lib/config";

export default function AuthWelcomePage() {
    return (
        <div
            style={{ backgroundImage: `url(${config.default_bg_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            className="flex items-center justify-center min-h-screen"
        >
            <AuthWelcomeFormComponent />
        </div>
    );
}