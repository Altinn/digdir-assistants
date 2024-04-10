import { createClient, SupabaseClient } from "@supabase/supabase-js";

console.log("Initializing Supabase client with provided URL and Anon Key.");

// Initialize Supabase client
const supabaseUrl = "https://ncxehajalbrwbicnzxmn.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jeGVoYWphbGJyd2JpY256eG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDQ0Nzk2MzIsImV4cCI6MjAyMDA1NTYzMn0.6tap1Sj5yM7xEfw5umVSLQ9R8iLw3b9rankEsneiJqM";

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
