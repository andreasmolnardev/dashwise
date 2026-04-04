import { Icon } from "@iconify-icon/react";
import { Link } from "react-router-dom";
import { Label } from "../ui/label";

export default function DashwiseAppLayoutTemplateComponent({ children, title }: { children: React.ReactNode; title: string }) {
   return (
        <div className="flex h-dvh bg-(--surface) backdrop-blur-[5px] backdrop-brightness-85 text-white p-8">
            <div className="w-[30%]">
                <h1 className="scroll-m-20 text-4xl font-bold tracking-tight text-balance">{title}</h1>

                <div className="relative flex flex-col h-[calc(100%-35px)] justify-between py-4">
                    <div className="space-y-1">
                    
                      
                    </div>

                    <Link key="/home" to="/home" className="block group">
                        <div
                            className={`flex items-center space-x-2 p-2 settings-label-div round-md relative`}
                            data-href="/home"
                        >
                            <Icon icon="fa6-solid:house" className=" group-hover:text-(--primary)" />
                            <Label>Go to dashboard</Label>
                        </div>
                    </Link>
                </div>

            </div>

            <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
    );
}