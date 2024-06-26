import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import supabase from "../supabase/SupabaseClient";
import { Message } from "../models/Models";
import { RealtimeChannel } from "@supabase/supabase-js";

export const useMessages = (channelId: string) => {
  const queryClient = useQueryClient();
  const subscription = useRef<RealtimeChannel | null>(null);
  const previousChannelId = useRef<string | null>(null);
  const [currentMessageId, setCurrentMessageId] = useState<{
    ts_date: number;
    ts_time: number;
  } | null>(null);

  const fetchMessages = async ({ queryKey }: any) => {
    const [_key, channelId] = queryKey;
    console.log(`Fetching messages for channel: ${channelId}`);
    try {
      const { data, error } = await supabase
        .from("slack_message")
        .select("*")
        .eq("channel_id", channelId)
        .eq("thread_ts_date", 0)
        .order("ts_date", { ascending: true });

      if (error) {
        console.error("Error fetching messages:", error.message, error.details);
        throw new Error(error.message);
      }

      console.log("Messages fetched successfully.");
      return data;
    } catch (error) {
      console.error(
        "Error in fetchMessages:",
        error instanceof Error ? error.message : "An unknown error occurred",
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  };

  const {
    data: messages,
    error,
    isLoading,
  } = useQuery<Message[], Error>({
    queryKey: ["messages", channelId],
    queryFn: fetchMessages,
    enabled: !!channelId,
  });

  useEffect(() => {
    const subscribeToMessages = async () => {
      if (!channelId || previousChannelId.current === channelId) return;

      console.log(`Subscribing to real-time updates for channel: ${channelId}`);
      subscription.current = await supabase
        .channel(`slack_message:channel_id=eq.${channelId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "slack_message" },
          (payload) => {
            queryClient.setQueryData(
              ["messages", channelId],
              (oldMessages: Message[] | undefined) => {
                if (payload.new.thread_ts_date === 0) {
                  console.log(
                    `New chat message received for channel ${channelId}:`,
                    payload.new,
                  );
                  return oldMessages
                    ? [...oldMessages, payload.new]
                    : [payload.new];
                }
                return oldMessages;
              },
            );
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log(`Subscription status: ${status}`);
          } else {
            console.error(`Subscription error: ${status}`);
          }
        });

      previousChannelId.current = channelId;
    };

    subscribeToMessages();

    return () => {
      if (subscription.current && previousChannelId.current !== channelId) {
        console.log(
          `Removing subscription for channel: ${previousChannelId.current}.`,
        );
        supabase.removeChannel(subscription.current);
        subscription.current = null;
      }
    };
  }, [channelId, queryClient, currentMessageId]);

  return { messages, error, isLoading, setCurrentMessageId, currentMessageId };
};
