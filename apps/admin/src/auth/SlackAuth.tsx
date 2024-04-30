import supabase from "../supabase/SupabaseClient";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isLoggedIn } from "./authUtils";

async function signInWithSlack() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "slack",
  });
}

const SlackAuth = () => {
  const navigate = useNavigate();
  useEffect(() => {
    // Define an async function inside the useEffect
    const checkLoginAndSignIn = async () => {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) {
        await signInWithSlack();
      } else {
        navigate("/"); // Use navigate for navigation instead of window.location.href for better SPA behavior
      }
    };

    // Call the async function
    checkLoginAndSignIn();
  }, [navigate]); // Add dependencies here if any

  return null;
};

export default SlackAuth;
