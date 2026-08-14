import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "jsdom",
        alias: {
            // `siyuan` npm package ships types only; runtime is provided by the
            // SiYuan host. Alias to a local mock for unit tests.
            siyuan: path.resolve(__dirname, "src/__mocks__/siyuan.ts"),
        },
    },
});
