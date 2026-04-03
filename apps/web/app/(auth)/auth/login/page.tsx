"use client";
import LoginCard from "@/components/auth/LoginForm";
import config from "@/lib/config";

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