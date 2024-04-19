import { createClient, SupabaseClient } from "@supabase/supabase-js";

console.log("Initializing Supabase client with provided URL and Anon Key.");

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SLACK_APP_SUPABASE_API_URL;

const supabaseAnonKey = import.meta.env.VITE_SLACK_APP_SUPABASE_ANON_KEY;

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

supabase.auth
  .getSession()
  .then((session) => {
    console.log(
      "Supabase client initialized successfully. Current session:",
      session,
    );
  })
  .catch((error) => {
    console.error("Error initializing Supabase client:", error.message, error);
  });

export default supabase;
