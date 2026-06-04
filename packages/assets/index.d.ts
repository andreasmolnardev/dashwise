export declare const defaultHomeConfig: {
    template: string;
    columns: {
        left: {
            placeholder: {
                height: string;
            };
        };
        middle: {
            "main-clock": {
                index: number;
                glanceables: {
                    date: null;
                    weather: null;
                };
            };
            "search-bar": {
                index: number;
            };
            "link-view": {
                index: number;
            };
        };
        right: {
            placeholder: {
                height: string;
            };
        };
    };
};
export declare const defaultIntegrationsManifest: {
    weather: {
        source: string;
        defaultEnv: {};
    };
};
export declare const defaultShortcutsManifest: {
    name: string;
    icon: string;
    secondary: string;
    action: string;
    tags: string[];
}[];
export declare const defaultIntegrationsBlueprint: any;
export declare const weatherIntegrationBlueprint: any;
