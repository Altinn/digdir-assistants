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
      if (envVar('LOG_LEVEL') == 'debug') {
        console.log(
          `before merge:\n${JSON.stringify(merged)}\nmerging with:\n${JSON.stringify(value)}`,
        );
      }
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

      console.log(`db config fetched. Here are all the rows:\n${JSON.stringify(cachedConfigDb)}`);
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

  if (envVar('LOG_LEVEL') == 'debug') {
    console.log(
      `matching config db rows for app: ${JSON.stringify(app)}, context: ${JSON.stringify(context)}`,
    );
  }

  for (let configDbRow of configDbRows) {
    const app_id_matches =
      isNullOrEmpty(configDbRow.slack_app?.app_id) || configDbRow.slack_app?.app_id == app.app_id;
    const channel_matches =
      isNullOrEmpty(configDbRow.slack_context?.channel_id) ||
      configDbRow.slack_context?.channel_id == context.channel_id;
    const team_matches =
      isNullOrEmpty(configDbRow.slack_context?.team_id) ||
      configDbRow.slack_context?.team_id == context.team_id;
    const bot_name_matches =
      isNullOrEmpty(configDbRow.slack_app?.bot_name) ||
      configDbRow.slack_app?.bot_name == app.bot_name;

    if (app_id_matches && channel_matches && team_matches && bot_name_matches) {
      matching.push(configDbRow);
      if (envVar('LOG_LEVEL') == 'debug') {
        console.log(`Matching ConfigDbRow ID: ${configDbRow.id}, app: ${JSON.stringify(configDbRow.slack_app)}, 
          context: ${JSON.stringify(configDbRow.slack_context)}}\n--> config: ${JSON.stringify(configDbRow.config)}`);
      }
    }
  }

  return matching;
}

function sortBotConfig(a: BotConfigDbRow, b: BotConfigDbRow) {
  if (
    (isNullOrEmpty(a?.slack_app?.bot_name) && !isNullOrEmpty(b?.slack_app?.bot_name)) ||
    (isNullOrEmpty(a?.slack_app?.app_id) && !isNullOrEmpty(b?.slack_app?.app_id)) ||
    (isNullOrEmpty(a?.slack_context?.channel_id) && !isNullOrEmpty(b?.slack_context?.channel_id)) ||
    (isNullOrEmpty(a?.slack_context?.team_id) && !isNullOrEmpty(b?.slack_context?.team_id))
  ) {
    return -1;
  }

  if (
    (isNullOrEmpty(b?.slack_app?.bot_name) && !isNullOrEmpty(a?.slack_app?.bot_name)) ||
    (isNullOrEmpty(b?.slack_app?.app_id) && !isNullOrEmpty(a?.slack_app?.app_id)) ||
    (isNullOrEmpty(b?.slack_context?.channel_id) && !isNullOrEmpty(a?.slack_context?.channel_id)) ||
    (isNullOrEmpty(b?.slack_context?.team_id) && !isNullOrEmpty(a?.slack_context?.team_id))
  ) {
    return 1;
  }
  return 0;
}
