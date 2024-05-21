import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import supabase from "../supabase/SupabaseClient";
import { Channel } from "../models/Models";

interface UseChannelsProps {
  selectedTeam: string;
}

export const useChannels = ({ selectedTeam }: UseChannelsProps) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selectedTeam) return;

    const subscription = supabase
      .channel(`public:slack_channel:team_id=eq.${selectedTeam}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slack_channel" },
        (payload) => {
          console.log(
            `Realtime update received for channels in team ${selectedTeam}:`,
            payload.new,
          );
          queryClient.invalidateQueries(["channels", selectedTeam]);
        },
      )
      .subscribe(
        (status) => {
          console.log(`Subscription status: ${status}`);
        },
        (error) => {
          console.error(
            "Error subscribing to channel updates:",
            error.message,
            error.stack,
          );
        },
      );

    return () => {
      console.log("Unsubscribing from channel updates.");
      supabase.removeChannel(subscription);
    };
  }, [selectedTeam, queryClient]);

  return useQuery<Channel[], Error>({
    queryKey: ["channels", selectedTeam],
    queryFn: async () => {
      try {
        if (!selectedTeam) {
          return [];
        }
        const { data, error } = await supabase
          .from("slack_channel")
          .select("*")
          .eq("team_id", selectedTeam)
          .order("name", { ascending: true });

        if (error) {
          console.error("Error fetching channels:", error.message, error.stack);
          throw new Error(error.message);
        }
        console.log("Channels fetched successfully with React Query.", data);
        return data;
      } catch (error) {
        console.error(
          "Error in useChannels query:",
          error instanceof Error ? error.message : "An unknown error occurred",
        );
        throw error;
      }
    },
    enabled: !!selectedTeam,
  });
};
