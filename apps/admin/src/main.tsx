import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import MainRoutes from "./routes/Routes.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

console.log("Initializing the application...");

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MainRoutes />
    </QueryClientProvider>
  </React.StrictMode>,
);
