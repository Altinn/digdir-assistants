import { useQuery } from "@tanstack/react-query";
import supabase from "../supabase/SupabaseClient";
import { Message } from "../models/Models";

interface ThreadRepliesParams {
  channelId: string;
  thread_ts_date: number;
  thread_ts_time: number;
}

const fetchThreadReplies = async ({
  channelId,
  thread_ts_date,
  thread_ts_time,
}: ThreadRepliesParams): Promise<Message[]> => {
  console.log(
    `Fetching thread replies for channel: ${channelId}, date: ${thread_ts_date}, time: ${thread_ts_time}`,
  );
  try {
    const { data, error } = await supabase
      .from("slack_message")
      .select("*")
      .eq("channel_id", channelId)
      .eq("thread_ts_date", thread_ts_date)
      .eq("thread_ts_time", thread_ts_time)
      .order("ts_date", { ascending: true })
      .order("ts_time", { ascending: true });

    if (error) {
      console.error(
        "Error fetching thread replies:",
        error.message,
        error.details,
      );
      throw new Error(error.message);
    }

    console.log("Thread replies fetched successfully.");
    return data;
  } catch (error) {
    console.error(
      "Error in fetchThreadReplies:",
      error instanceof Error ? error.message : "An unknown error occurred",
      error instanceof Error ? error.stack : "",
    );
    throw error;
  }
};

export const useThreadReplies = ({
  channelId,
  thread_ts_date: thread_ts_date,
  thread_ts_time: thread_ts_time,
}: ThreadRepliesParams) => {
  return useQuery<Message[], Error>({
    queryKey: ["threadReplies", channelId, thread_ts_date, thread_ts_time],
    queryFn: () =>
      fetchThreadReplies({ channelId, thread_ts_date, thread_ts_time }),
    enabled: !!channelId && !!thread_ts_date && !!thread_ts_time,
  });
};
