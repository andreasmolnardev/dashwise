import LoginCard from "@/components/auth/LoginForm";
import { createFileRoute } from "@tanstack/react-router";
import config from "@/lib/config";

export const Route = createFileRoute("/auth/login")({ component: LoginPage });

export default function LoginPage() {
    return (
        <div
            style={{ backgroundImage: `url(${config.default_bg_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            className="flex items-center justify-center min-h-screen"
        >
            <LoginCard />
        </div>
    );
}
