import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import supabase from "../supabase/SupabaseClient";
import { User } from "../models/Models";

interface UseUsersProps {
  selectedTeam: string;
}

export const useUsers = ({ selectedTeam }: UseUsersProps) => {
  const queryClient = useQueryClient();

  // const getUserById = (userId: string) => {
  //   const { data: users } = useQuery<User[], Error>({
  //     queryKey: ["users", selectedTeam],
  //     queryFn: async () => {
  //       try {
  //         if (!selectedTeam) {
  //           return [];
  //         }
  //         const { data, error } = await supabase
  //           .from("user")
  //           .select("*")
  //           .eq("team_id", selectedTeam);
  //         if (error) {
  //           console.error("Error fetching users:", error.message, error.details);
  //           throw new Error(error.message);
  //         }
  //         return data;
  //       } catch (error) {
  //         console.error(
  //           "Error in useUsers query:",
  //           error instanceof Error ? error.message : "An unknown error occurred",
  //         );
  //         throw error;
  //       }
  //     },
  //     enabled: !!selectedTeam,
  //   });

  //   return users?.find((user) => user.user_id === userId);
  // };

  useEffect(() => {
    if (!selectedTeam) return;

    const subscription = supabase
      .channel(`public:slack_user:team_id=eq.${selectedTeam}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slack_user" },
        (payload) => {
          console.log(
            `Realtime update received for users in team ${selectedTeam}:`,
            payload.new,
          );
          queryClient.invalidateQueries(["users", selectedTeam]);
        },
      )
      .subscribe(
        (status) => {
          console.log(`Subscription status: ${status}`);
        },
        (error) => {
          console.error(
            "Error subscribing to user updates:",
            error.message,
            error.stack,
          );
        },
      );

    return () => {
      console.log("Unsubscribing from user updates.");
      supabase.removeChannel(subscription);
    };
  }, [selectedTeam, queryClient]);

  return useQuery<User[], Error>({
    queryKey: ["users", selectedTeam],
    enabled: !!selectedTeam,
    queryFn: async (): Promise<User[]> => {
      try {
        if (!selectedTeam) {
          console.log("No team selected, won't fetch users");
          return [];
        }
        console.log(`Fetching users for team: ${selectedTeam}`);
        const { data, error } = await supabase
          .from("slack_user")
          .select("*")
          .eq("team_id", selectedTeam);
        if (error) {
          console.error("Error fetching users:", error.message, error.details);
          throw new Error(error.message);
        }
        console.log("Users fetched successfully with React Query.", data);
        return data;
      } catch (error) {
        console.error(
          "Error in useUsers query:",
          error instanceof Error ? error.message : "An unknown error occurred",
        );
        throw error;
      }
    },
  });
};
