"use client";
import DashboardLayoutComponent from "@/components/dashboard/DashboardLayout";
import { useEffect } from "react";

export default function DashboardPage() {
    useEffect(() => {
        const token = document.cookie
            .split('; ')
            .find(row => row.startsWith('pb_token='))
            ?.split('=')[1];

        if (token) {
            localStorage.setItem('pb_token', token);
        }
    }, []);
    
    return (
        <DashboardLayoutComponent />
    );
}