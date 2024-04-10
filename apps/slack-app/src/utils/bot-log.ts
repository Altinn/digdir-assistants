import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SlackApp, SlackContext } from './slack';
import { envVar } from '@digdir/assistant-lib';
import { z } from 'zod';

export const BotLogEntrySchema = z.object({
  slack_context: z.object({
    ts_date: z.number(),
    ts_time: z.number(),
    thread_ts_date: z.number().optional(),
    thread_ts_time: z.number().optional(),
    channel_id: z.string(),
    channel_type: z.string().optional(),
    channel_name: z.string(),
    team_id: z.string().optional(),
    team_name: z.string().optional(),
    user_id: z.string().optional(),
    user_name: z.string().optional(),
    user_type: z.string().default('human').optional(),
    time_utc: z.string().optional(),
  }),
  slack_app: z.object({
    app_id: z.string(),
    bot_name: z.string().optional(),
  }),
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
  envVar('SLACK_BOT_SUPABASE_URL'),
  envVar('SLACK_BOT_SUPABASE_API_KEY'),
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

  // log to new function endpoint first
  const functionUrl = envVar('SLACK_BOT_SUPABASE_URL') + '/functions/v1/log_slack_message';
  const functionResponse = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: envVar('SLACK_BOT_SUPABASE_API_KEY'),
    },
    body: JSON.stringify(slackMessage),
  });
  if (!functionResponse.ok) {
    console.error(`Function call failed with status ${functionResponse.status}`);
    return null;
  }

  return;

  // var insertResponse;

  // try {
  //   insertResponse = await supabase.from('bot_log').insert([entry]);
  // } catch (supabaseEx) {
  //   console.log(`Supabase error occurred when attempting to log:\n${supabaseEx}`);
  //   return null;
  // }

  // if (envVar('LOG_LEVEL') === 'debug') {
  //   console.log(`insertResponse: ${JSON.stringify(insertResponse)}`);
  // }

  // return insertResponse;
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
