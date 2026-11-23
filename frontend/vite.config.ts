import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === "true" &&
    process.env.GITHUB_REPOSITORY?.toLowerCase() === "mitanshmistry/proofly";

  return {
    base: env.VITE_BASE_PATH || (isGitHubPagesBuild ? "/proofly/" : "/"),
    plugins: [react()],
    define: { __GITHUB_PAGES__: JSON.stringify(isGitHubPagesBuild) },
    server: {
      port: 5173,
      proxy: { "/api": env.VITE_API_PROXY_TARGET || "http://localhost:8080" }
    }
  };
});
