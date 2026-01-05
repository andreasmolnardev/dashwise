"use client";
import DashboardLayoutComponent from "@/components/dashboard/DashboardLayout";
import { useEffect } from "react";
import useAuth from "@/context/useAuth";

export default function DashboardPage() {
    const { user, token, setAuth } = useAuth();

    useEffect(() => {
        const tokenFromCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('pb_token='))
            ?.split('=')[1];

        if (tokenFromCookie && tokenFromCookie !== token) {
            setAuth(user, tokenFromCookie);
        }
    }, [token, setAuth, user]);
    
    return (
        <DashboardLayoutComponent />
    );
}