import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "../App.jsx";
import SlackAuth from "../auth/SlackAuth.tsx";
import EmailAuth from "../auth/EmailAuth.tsx";
import { isLoggedIn } from "../auth/authUtils.ts";

const MainRoutes = () => {
  console.log("Initializing routing...");

  return (
    <BrowserRouter>
      <Routes>
        {/* Route for the main application view */}
        <Route
          path="/"
          element={isLoggedIn() ? <App /> : <Navigate to="/auth/email" />}
        />

        {/* Route for the Slack authentication callback */}
        <Route path="/auth" element={<SlackAuth />} />

        {/* Route for email authentication */}
        <Route path="/auth/email" element={<EmailAuth />} />

        {/* Redirect based on authentication status */}
        <Route
          path="*"
          element={isLoggedIn() ? <Navigate to="/" /> : <Navigate to="/auth" />}
        />
      </Routes>
    </BrowserRouter>
  );
};

export default MainRoutes;
