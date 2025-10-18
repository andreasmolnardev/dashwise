"use client";
import { useConfig } from "@/context/ConfigContext";
import { useEffect } from "react";
import SearchBar from "../widgets/SearchBar";
import { Separator } from "@radix-ui/react-separator";

export default function SearchLayoutComponent({
}) {
    const { config, refreshConfig } = useConfig();

    return (
        <div className="h-full flex items-center justify-center flex-col  backdrop-blur-[3px] backdrop-brightness-85">
            <main className=" bg-white/10 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 shadow-sm rounded-md w-[65%] h-[50%] p-2.5
     ">
                <input
                    type="text"
                    data-slot="input"
                    className="w-full bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 
               focus:outline-none"
                    placeholder="Search..."
                />
                <Separator />
                <ul>
                    <li>Test</li>
                </ul>
            </main>
        </div>
    );
}