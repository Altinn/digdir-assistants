import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { envVar, isNullOrEmpty } from '@digdir/assistant-lib';
import { SlackApp, SlackAppSchema, SlackContext, SlackContextSchema } from './slack';

const BotConfigSchema = z.object({
  ignoreWhenNotTagged: z.boolean().optional(),
});
type BotConfig = z.infer<typeof BotConfigSchema>;

const BotConfigDbRowSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  config: z.object(BotConfigSchema.shape),
  slack_context: z.object(SlackContextSchema.shape),
  slack_app: z.object(SlackAppSchema.shape),
});
type BotConfigDbRow = z.infer<typeof BotConfigDbRowSchema>;

let cachedConfigDb: BotConfigDbRow[] | null = null;
let configFetchTimestamp: number | null = null;

// create single supabase client
const supabase: SupabaseClient = createClient(
  envVar('SLACK_BOT_SUPABASE_URL'),
  envVar('SLACK_BOT_SUPABASE_API_KEY'),
);

export async function lookupConfig<T>(
  app: SlackApp,
  context: SlackContext,
  propName: string,
  defaultValue: T,
): Promise<T | null> {
  let merged = {};

  const matching = await fetchConfig(app, context);

  if (matching) {
    for (let value of matching) {
      merged = { ...merged, ...value.config };
    }
  }

  if (envVar('LOG_LEVEL') == 'debug') {
    console.log(`lookupConfig, merged result:\n${JSON.stringify(merged)}`);
  }
  if (merged && propName in merged) {
    const configValue = merged[propName as keyof typeof merged] as T;
    const result = configValue === undefined ? defaultValue : configValue;
    if (envVar('LOG_LEVEL') == 'debug') {
      console.log(`lookupConfig found ${propName}: ${result}`);
    }
    return result;
  }
  return defaultValue;
}

async function fetchConfig(app: SlackApp, context: SlackContext): Promise<BotConfigDbRow[] | null> {
  try {
    if (
      !cachedConfigDb ||
      !configFetchTimestamp ||
      performance.now() - configFetchTimestamp > 10000
    ) {
      let { data, error } = await supabase.from('bot_config').select('*');
      if (error) {
        console.error('Error fetching bot_config:', error);
        return null;
      }
      cachedConfigDb = data as BotConfigDbRow[];
    }
    if (cachedConfigDb) {
      const matching = matchingConfigDbRows(cachedConfigDb, app, context);
      return matching;
    }
  } catch (error) {
    console.error('Unexpected error fetching bot_config:', error);
    return null;
  }
  return null;
}

function matchingConfigDbRows(
  configDbRows: BotConfigDbRow[],
  app: SlackApp,
  context: SlackContext,
): BotConfigDbRow[] {
  let matching: BotConfigDbRow[] = [];

  configDbRows.sort(sortBotConfig);

  for (let configDbRow of configDbRows) {
    if (
      (isNullOrEmpty(configDbRow.slack_app?.app_id) ||
        configDbRow.slack_app?.app_id === app.app_id) &&
      (isNullOrEmpty(configDbRow.slack_context?.channel) ||
        configDbRow.slack_context?.channel === context.channel) &&
      (isNullOrEmpty(configDbRow.slack_context?.team) ||
        configDbRow.slack_context?.team === context.team) &&
      (isNullOrEmpty(configDbRow.slack_app?.bot_name) ||
        configDbRow.slack_app?.bot_name == app.bot_name)
    ) {
      matching.push(configDbRow);
    }
  }

  return configDbRows;
}

function sortBotConfig(a: BotConfigDbRow, b: BotConfigDbRow) {
  if (
    (isNullOrEmpty(a?.slack_app?.bot_name) && !isNullOrEmpty(b?.slack_app?.bot_name)) ||
    (isNullOrEmpty(a?.slack_app?.app_id) && !isNullOrEmpty(b?.slack_app?.app_id)) ||
    (isNullOrEmpty(a?.slack_context?.channel) && !isNullOrEmpty(b?.slack_context?.channel)) ||
    (isNullOrEmpty(a?.slack_context?.team) && !isNullOrEmpty(b?.slack_context?.team))
  ) {
    return -1;
  }

  if (
    (isNullOrEmpty(b?.slack_app?.bot_name) && !isNullOrEmpty(a?.slack_app?.bot_name)) ||
    (isNullOrEmpty(b?.slack_app?.app_id) && !isNullOrEmpty(a?.slack_app?.app_id)) ||
    (isNullOrEmpty(b?.slack_context?.channel) && !isNullOrEmpty(a?.slack_context?.channel)) ||
    (isNullOrEmpty(b?.slack_context?.team) && !isNullOrEmpty(a?.slack_context?.team))
  ) {
    return 1;
  }
  return 0;
}
