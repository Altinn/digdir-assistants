import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SlackContext } from './slack';
import { envVar } from '@digdir/assistant-lib';
import { Data } from 'dataclass';

export class BotLogEntry extends Data {
  slack_context?: SlackContext | null = null;
  elapsed_ms: number = 0;
  step_name: string = '';
  payload?: any | null = null;
  rag_llm_feedback?: any | null = null;
  durations?: object | null = null;
}

// create single supabase client
const supabase: SupabaseClient = createClient(
  envVar('SLACK_BOT_SUPABASE_URL'),
  envVar('SLACK_BOT_SUPABASE_API_KEY'),
);

export async function botLog(entry: BotLogEntry) {
  var insertResponse;

  try {
    insertResponse = await supabase.from('bot_log').insert([entry]);
  } catch (supabaseEx) {
    console.log(`Supabase error occurred when attempting to log:\n${supabaseEx}`);
    return null;
  }

  if (envVar('LOG_LEVEL') === 'debug') {
    console.log(`insertResponse: ${JSON.stringify(insertResponse)}`);
  }

  return insertResponse;
}

export async function updateReactions(slackContext: SlackContext, reactions: any) {
  const ts = slackContext.ts;
  const channel = slackContext.channel;
  // retrieve the correct row, looking for slackContext.ts in the slackContext column, which is jsonb type
  const resultSet = await supabase
    .from('bot_log')
    .select('*')
    .eq('slack_context->>ts', ts)
    .eq('slack_context->>channel', channel);

  if (resultSet && resultSet.data && resultSet.data.length > 0) {
    // update the row, storing the reactions object in the field called 'reactions'
    const updateResponse = supabase
      .from('bot_log')
      .update({ reactions: reactions })
      .eq('id', resultSet.data[0].id);

    if (envVar('LOG_LEVEL') === 'debug') {
      console.log(`updateResponse: ${JSON.stringify(updateResponse)}`);
    }
    return resultSet.data[0]
  }

  return null;
}
