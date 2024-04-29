import { z } from "zod";

const UserSchema = z.object({
  user_id: z.string(),
  name: z.string(),
  type: z.string(),
  team_id: z.string(),
});
export type User = z.infer<typeof UserSchema>;

const MessageSchema = z.object({
  ts: z.string(),
  ts_date: z.number(),
  ts_time: z.number(),
  thread_ts_date: z.number(),
  thread_ts_time: z.number(),
  content: z.union([z.object({}), z.array(z.object({}))]),
  content_type: z.string(),
  created_at: z.string(),
  user_id: z.string(),
  durations: z.object({}).optional(),
});
export type Message = z.infer<typeof MessageSchema>;

const DocsUserQuerySchema = z.object({
  bot_name: z.string(),
  english_user_query: z.string(),
  original_user_query: z.string(),
  user_query_language_code: z.string(),
  user_query_language_name: z.string(),
  content_category: z.string(),
});
export type DocsUserQuery = z.infer<typeof DocsUserQuerySchema>;

const RagPipelineResultSchema = z.object({
  original_user_query: z.string(),
  english_user_query: z.string(),
  user_query_language_name: z.string(),
  english_answer: z.string(),
  translated_answer: z.string(),
  rag_success: z.boolean(),
  search_queries: z.array(z.string()),
  source_urls: z.array(z.string()),
  source_documents: z.array(z.any()), // Assuming we don't have a specific structure for documents
  relevant_urls: z.array(z.string()),
  not_loaded_urls: z.array(z.string()),
  durations: z.record(z.string(), z.number()), // Assuming durations is an object with string keys and number values
});

export type RagPipelineResult = z.infer<typeof RagPipelineResultSchema>;

export type RagPipelineMessage = Message & {
  content: RagPipelineResult;
};

export interface Props {
  channelId: string;
  thread_ts_date: number;
  thread_ts_time: number;
}

// Define a new Zod schema for ThreadReply
const ThreadReplySchema = z.object({
  id: z.string(),
  ts_date: z.number(),
  ts_time: z.number(),
  content: z.string(),
  user_name: z.string(),
  thread_ts_date: z.number(),
  thread_ts_time: z.number(),
});

export type ThreadReply = z.infer<typeof ThreadReplySchema>;


export interface DocsUserQueryMessage {
  message: Message & {
    content: DocsUserQuery;
  };
}

export interface DocsBotReplyMessage {
  message: Message & {
    content: RagPipelineResult;
  };
}

