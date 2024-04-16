import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SlackApp, SlackAppSchema, SlackContext, SlackContextSchema } from './slack';
import { envVar } from '@digdir/assistant-lib';
import { z } from 'zod';

export const BotLogEntrySchema = z.object({
  slack_context: SlackContextSchema,
  slack_app: SlackAppSchema,
  elapsed_ms: z.number(),
  step_name: z.string(),
  content: z.any().optional(),
  content_type: z.string().optional(),
  durations: z.any().optional(),
});

export type BotLogEntry = z.infer<typeof BotLogEntrySchema>;

interface SlackMessage {
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  channel_type: string;
  user_id: string;
  user_name: string;
  user_type: string;
  ts_date: number;
  ts_time: number;
  thread_ts_date?: number;
  thread_ts_time?: number;
  content?: object | Array<object>;
  content_type?: string;
  bot_name: string;
  step_name: string;
  durations: object;
}

// create single supabase client
const supabase: SupabaseClient = createClient(
  envVar('SLACK_APP_SUPABASE_API_URL'),
  envVar('SLACK_APP_SUPABASE_ANON_KEY'),
);

export async function botLog(entry: BotLogEntry) {
  const slackMessage: SlackMessage = {
    team_id: entry.slack_context?.team_id || '',
    team_name: entry.slack_context?.team_name || '',
    channel_id: entry.slack_context?.channel_id || '',
    channel_name: entry.slack_context?.channel_name || '',
    channel_type: entry.slack_context?.channel_type || '',
    user_id: entry.slack_context?.user_id || '',
    user_name: entry.slack_context?.user_name || '',
    user_type: entry.slack_context?.user_type || '',
    ts_date: entry.slack_context?.ts_date || 0,
    ts_time: entry.slack_context?.ts_time || 0,
    thread_ts_date: entry.slack_context?.thread_ts_date,
    thread_ts_time: entry.slack_context?.thread_ts_time,
    content: entry.content,
    content_type: entry.content_type,
    bot_name: entry.slack_app?.bot_name || '',
    step_name: entry.step_name || '',
    durations: entry.durations,
  };

  const functionUrl = envVar('SLACK_APP_SUPABASE_API_URL') + '/functions/v1/log_slack_message';
  const functionResponse = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: envVar('SLACK_APP_SUPABASE_ANON_KEY'),
    },
    body: JSON.stringify(slackMessage),
  });
  if (!functionResponse.ok) {
    console.error(`Function call failed with status ${functionResponse.status}`);
    return null;
  }

  return;
}

export async function updateReactions(
  slackApp: SlackApp,
  slackContext: SlackContext,
  reactions: any,
): Promise<BotLogEntry | null> {
  // console.log(`updating reactions:\nts: ${slackContext.ts_date + '.' + slackContext.ts_time}`);
  // console.log(`reactions: \n${JSON.stringify(reactions)}`)

  // Only update existing db rows
  const { data, error } = await supabase
    .from('slack_message')
    .update({ reactions: reactions })
    .eq('ts_date', slackContext.ts_date)
    .eq('ts_time', slackContext.ts_time)
    .eq('channel_id', slackContext.channel_id);

  if (error) {
    console.error(`Error updating reactions: ${error.message}`);
    return null;
  }
  if (envVar('LOG_LEVEL') === 'debug') {
    console.log(`Update reactions response: ${JSON.stringify(data)}`);
  }

  // Retrieve the same message again from the db
  const { data: updatedData, error: retrieveError } = await supabase
    .from('slack_message')
    .select('*')
    .eq('ts_date', slackContext.ts_date)
    .eq('ts_time', slackContext.ts_time)
    .eq('channel_id', slackContext.channel_id);

  if (retrieveError) {
    console.error(`Error updating reactions after update: ${retrieveError.message}`);
    return null;
  }
  return updatedData.length > 0 ? updatedData[0] : null;
}
