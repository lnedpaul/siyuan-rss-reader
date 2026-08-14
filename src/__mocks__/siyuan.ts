// Test-only mock for the `siyuan` host module (runtime API is provided by the
// SiYuan host; the npm package only ships TypeScript declarations).
export class Plugin {
    i18n: Record<string, string> = {};
    loadData: any = async () => null;
    saveData: any = async () => { };
    app: any = {};
    addTab: any = () => { };
    addCommand: any = () => { };
    addTopBar: any = () => { };
    addIcons: any = () => { };
    getOpenedTab: any = () => ({});
}

export const showMessage = () => { };

export class Dialog {
    element: HTMLElement | null = null;
    destroy() { }
}

export const fetchSyncPost = async () => ({ code: 0, data: {} });

export const openTab = async () => ({});
