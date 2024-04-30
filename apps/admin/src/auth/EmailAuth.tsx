import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button, TextField, Box, Typography } from "@mui/material";
import supabase from "../supabase/SupabaseClient";
import { isLoggedIn } from "../auth/authUtils";

const EmailAuth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      if (await isLoggedIn()) {
        console.log("User already logged in, redirecting to home page.");
        window.location.href = "/";
      }
    })();
  }, [navigate]);

  const handleSignUp = async () => {
    const {
      data: { user, session },
      error,
    } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.error("Error signing up:", error.message, error.stack);
      setError("Sign up failed: " + error.message);
    } else {
      console.log(
        "Sign up successful, storing session and navigating to home page.",
      );
      localStorage.setItem("authToken", JSON.stringify(session)); // Store the entire session object as 'authToken'
      navigate("/");
    }
  };

  const handleSignIn = async () => {
    const {
      data: { user, session },
      error,
    } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("Error signing in:", error.message, error.stack);
      setError("Sign in failed: " + error.message);
    } else {
      console.log(
        "Sign in successful, storing session and navigating to home page.",
      );
      console.log("Navigating to site root...");
      navigate("/");
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
    >
      <TextField
        label="Email"
        variant="outlined"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        margin="normal"
      />
      <TextField
        label="Password"
        type="password"
        variant="outlined"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        margin="normal"
      />
      <Button
        onClick={handleSignIn}
        variant="contained"
        color="primary"
        style={{ margin: 8 }}
      >
        Sign In
      </Button>
      <Button onClick={handleSignUp} variant="outlined" color="secondary">
        Sign Up
      </Button>
      {error && (
        <Typography color="error" style={{ marginTop: 8 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};

export default EmailAuth;
