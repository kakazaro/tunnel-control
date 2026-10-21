import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import "@fontsource/orbitron/latin-700.css";
import "@fontsource/orbitron/latin-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles/index.css";
import App from "./App";
import { EffectsProvider } from "./hooks/useEffectsLevel";
import { fetcher } from "./lib/fetcher";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: true,
        dedupingInterval: 2000,
        // A 401 is not retried: the page locks instead.
        shouldRetryOnError: (error: unknown) =>
          (error as { status?: number } | undefined)?.status !== 401,
        errorRetryInterval: 5000,
      }}
    >
      <EffectsProvider>
        <App />
      </EffectsProvider>
    </SWRConfig>
  </StrictMode>,
);
