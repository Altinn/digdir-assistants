import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "../App.jsx";
import SlackAuth from "../auth/SlackAuth.tsx";
import EmailAuth from "../auth/EmailAuth.tsx";
import { isLoggedIn } from "../auth/authUtils.ts";

const MainRoutes = () => {
  console.log("Initializing routing...");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const authStatus = await isLoggedIn();
      setIsAuthenticated(authStatus);
      setAuthChecked(true);
    };

    checkAuth();
  }, []);

  if (!authChecked) {
    return <div>Loading...</div>; // Or any other loading indicator
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Route for the main application view */}
        <Route
          path="/"
          element={isAuthenticated ? <App /> : <Navigate to="/auth/email" />}
        />

        {/* Route for the Slack authentication callback */}
        <Route path="/auth/slack" element={<SlackAuth />} />

        {/* Route for email authentication */}
        <Route path="/auth/email" element={<EmailAuth />} />

        {/* Redirect based on authentication status */}
        <Route
          path="*"
          element={isAuthenticated ? <Navigate to="/" /> : <Navigate to="/auth" />}
        />
      </Routes>
    </BrowserRouter>
  );
};

export default MainRoutes;