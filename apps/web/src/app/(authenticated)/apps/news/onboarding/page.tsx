import NewsSubscriptionsOverview from "@/components/news/Subscriptions";

export default function NewsPage() {
     return (
        <div className="flex flex-col h-dvh bg-(--surface) backdrop-blur-[5px] backdrop-brightness-85 text-white p-8">
            <NewsSubscriptionsOverview />
        </div>
    );
}