import { Session } from '@supabase/supabase-js';
import supabase from "../supabase/SupabaseClient";

export const getToken = async () : Promise<Session | null> => {
  console.log("Retrieving authentication token from Supabase session.");
  try {
    const session = await getSession();
    if (session && session.access_token) {
      console.log("getToken(): Token found in Supabase session.");
      return session;
    } else {
      console.log("getToken(): No token found in Supabase session.");
      return null;
    }
  } catch (error) {
    console.error("getToken(): Error retrieving token from Supabase session.", error);
    return null;
  }
};

export const getSession = async () : Promise<Session | null> => {

  const { data, error } = await supabase.auth.getSession();
  console.log(`session data:\n${JSON.stringify(data)}`);
  return data?.session;
}

export const isLoggedIn = async () => {

  console.log("isLoggedIn(): Checking if user is logged in.");
  const session = await getToken();
  if (!session) {
    console.log("isLoggedIn(): No token found, user is not logged in.");
    return false;
  }

  try {
    const currentTime = new Date(Date.now()).getTime(); // Use Date.now() for UTC time
    const expiration = (session.expires_at * 1000);
    // Check if the 'expires_at' field exists in the session object
    if (!session.expires_at) {
      console.error("isLoggedIn(): Session object does not contain 'expires_at' field.");
      return false;
    }
    if (currentTime > expiration) {      
      console.log(`isLoggedIn(): Current time: ${currentTime}, Expires at: ${expiration} Token has expired, logging out user.`);
      logout();
      return false;
    }
    console.log("isLoggedIn(): User is logged in.");
    return true;
  } catch (error) {
    console.error(
      "isLoggedIn(): Error parsing token from local storage:",
      error.message,
      error.stack,
    );
    return false;
  }
};

export const logout = () => {
  console.log(
    "Logging out user and clearing authentication tokens from local storage.",
  );
  supabase.auth.signOut().then(() => {
    console.log("Supabase auth session ended successfully, redirecting to site root...");
    window.location.href = "/";
  }).catch((error) => {
    console.error("Error logging out of Supabase auth session:", error.message);
  });
};
