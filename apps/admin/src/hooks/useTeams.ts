import { useQuery } from "@tanstack/react-query";
import supabase from "../supabase/SupabaseClient";
import { Team } from "../models/Models";

const fetchTeams = async (): Promise<Team[]> => {
  console.log("Fetching teams from Supabase.");
  const { data, error } = await supabase.from("slack_team").select("*");

  if (error) {
    console.error("Error fetching teams:", error.message, error.stack);
    throw new Error(error.message);
  }

  console.log("Teams fetched successfully.");
  return data;
};

export const useTeams = () => {
  return useQuery<Team[], Error>({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });
};
