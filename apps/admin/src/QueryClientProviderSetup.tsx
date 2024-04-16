import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const QueryClientProviderSetup: React.FC = ({ children }) => {
  console.log("Setting up QueryClientProvider for react-query.");
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

export default QueryClientProviderSetup;
