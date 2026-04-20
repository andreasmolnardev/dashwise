export default function MonitoringHomePage() {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-semibold tracking-tight">
                Overview
            </h1>

            <div className="rounded-3xl frosted border border-white/10 p-6">
                <h2 className="text-xl font-semibold">No monitor selected</h2>
                <p className="mt-2 text-sm text-white/60">
                    Your monitored endpoints appear in the sidebar once they are
                    indexed. If you don’t see any monitors yet, make sure status
                    checking is enabled for your links.
                </p>
            </div>
        </div>
    );
}
