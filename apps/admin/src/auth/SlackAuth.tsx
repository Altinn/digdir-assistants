import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isLoggedIn } from "./authUtils";

// Replace 'YOUR_SLACK_CLIENT_ID' with your actual Slack Client ID
const SLACK_CLIENT_ID = "5978666457744.5949309775910";
// Replace '/auth/callback' with your actual OAuth redirect URI path
const REDIRECT_URI = `https://ncxehajalbrwbicnzxmn.supabase.co/auth/v1/callback`;

const SlackAuth = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) {
      console.error("Error during Slack OAuth flow:", error);
      // Handle error or redirect to an error page
      navigate("/error"); // Redirect to an error page or show an error message
      return;
    }

    // Check if the OAuth process has been initiated
    const code = new URLSearchParams(window.location.search).get("code");

    if (!code) {
      if (!isLoggedIn()) {
        const scope = "identity.basic"; // Define required scopes
        const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&user_scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
        console.log("Redirecting to Slack for authentication");
        window.location.href = slackAuthUrl;
      }
    } else {
      // Redirect to a server-side endpoint that handles the OAuth token exchange
      fetch(
        `/api/authenticate?code=${code}&redirectUri=${encodeURIComponent(REDIRECT_URI)}`,
      )
        .then((response) => response.json())
        .then((data) => {
          if (data.access_token) {
            localStorage.setItem("authToken", data.access_token); // Store the access token using a generic key
            console.log(
              "User authenticated successfully, redirecting to home page",
            );
            navigate("/");
          } else {
            throw new Error("No access token returned from server");
          }
        })
        .catch((error) => {
          console.error(
            "Error during Slack OAuth token exchange:",
            error.message,
            error.stack,
          );
          // Handle error or redirect to an error page
          navigate("/error"); // Redirect to an error page or show an error message
        });
    }
  }, [navigate]);

  return null;
};

export default SlackAuth;
