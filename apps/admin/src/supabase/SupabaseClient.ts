import { createClient, SupabaseClient } from "@supabase/supabase-js";

console.log("Initializing Supabase client with provided URL and Anon Key.");

// Initialize Supabase client
const supabaseUrl = window.location.href === 'https://digdir-assistants-test.gentlemoss-ac9ca445.norwayeast.azurecontainerapps.io/' 
  ? 'https://ncxehajalbrwbicnzxmn.supabase.co'
  : import.meta.env.VITE_SLACK_APP_SUPABASE_API_URL;
  
const supabaseAnonKey = window.location.href === 'https://digdir-assistants-test.gentlemoss-ac9ca445.norwayeast.azurecontainerapps.io/' 
  ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jeGVoYWphbGJyd2JpY256eG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTMyNzE0NTMsImV4cCI6MjAyODg0NzQ1M30.6aEnHNqCnMdaEQl_8iaI7aGIf3XBFTR8BEI7N55vFvU' 
  : import.meta.env.VITE_SLACK_APP_SUPABASE_ANON_KEY;

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
