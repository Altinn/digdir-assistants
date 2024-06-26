declare module '@bdb-dd/mack';

import { GenericMessageEvent } from '@slack/bolt';
import { ChatUpdateResponse, WebClient } from '@slack/web-api';
import { z } from 'zod';
import { ZSchema } from '@digdir/assistant-lib';
import ramda from 'ramda';

export const SlackContextSchema = z.object({
  ts_date: z.number(),
  ts_time: z.number(),
  thread_ts_date: z.number().optional(),
  thread_ts_time: z.number().optional(),
  channel_id: z.string(),
  channel_type: z.string().optional(),
  channel_name: z.string().optional(),
  team_id: z.string().optional(),
  team_name: z.string().optional(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  user_type: z.string().default('human').optional(),
  time_utc: z.string().optional(),
});
export type SlackContextType = z.infer<typeof SlackContextSchema>;

export class SlackContext extends ZSchema(SlackContextSchema) {
  private __strictUserOnly() {}
}
export class SlackContextPartial extends ZSchema(SlackContextSchema.partial()) {
  private __strictUserPartialOnly() {}
}

export const SlackAppSchema = z.object({
  app_id: z.string(),
  bot_name: z.string().optional(),
});
export type SlackAppType = z.infer<typeof SlackAppSchema>;
export class SlackApp extends ZSchema(SlackAppSchema) {
  private __strictUserOnly() {}
}
export class SlackAppPartial extends ZSchema(SlackAppSchema.partial()) {
  private __strictUserPartialOnly() {}
}

export async function getEventContext(
  client: WebClient,
  evt: GenericMessageEvent,
): Promise<SlackContext> {
  let conversations_info = await client.conversations.info({ channel: evt.channel });

  const channel_name: string =
    ramda.pathOr(null, ['channel', 'latest', 'bot_profile', 'name'], conversations_info) ||
    ramda.pathOr(null, ['message', 'bot_profile', 'name'], conversations_info) ||
    conversations_info.channel?.name ||
    '';

  let team_name = '';

  try {
    team_name = await client.team.info({ team: evt.team }).then((res) => res.team?.name || '');
  } catch (err) {
    console.error(`Error retrieving the team name. Error: ${err}`);
  }
  var user_name = '';
  if (evt.user) {
    const user_info = await client.users.info({ user: evt.user });
    user_name = user_info.user?.real_name || user_info.user?.name || '';
  }

  const { date: thread_ts_date, time: thread_ts_time } = parseSlackTs(evt.thread_ts || '0.0');
  const { date: ts_date, time: ts_time } = parseSlackTs(evt.ts || '0.0');

  console.log(
    `getEventContext: channel_type: ${evt.channel_type}. channel_name: ${channel_name}, team_name: ${team_name}`,
  );

  const slackContext = {
    ts_date,
    ts_time,
    thread_ts_date,
    thread_ts_time,
    channel_id: evt.channel,
    channel_name: channel_name,
    channel_type: evt.channel_type,
    team_id: evt.team,
    team_name: team_name,
    user_id: evt.user,
    user_name,
    user_type: 'human',
    time_utc: tsToTimestamptz(evt.ts),
  };
  return new SlackContext(slackContext);
}

export async function getChatUpdateContext(
  client: WebClient,
  threadStart: SlackContext,
  evt: ChatUpdateResponse,
): Promise<SlackContext> {
  const { date: ts_date, time: ts_time } = parseSlackTs(evt.ts || '');

  const context = {
    ts_date,
    ts_time,
    thread_ts_date: threadStart.ts_date,
    thread_ts_time: threadStart.ts_time,
    channel_id: evt.channel || '',
    team_id: threadStart.team_id,
    user_id: threadStart.user_id,
    user_type: 'human',
    time_utc: UtcNowTimestamptz(),
  };
  return new SlackContext(context);
}

export async function getThreadResponseContext(
  client: WebClient,
  threadStart: SlackContext,
  responseTs: string,
): Promise<SlackContext> {
  const { date: ts_date, time: ts_time } = parseSlackTs(responseTs || '');

  const slackContext = {
    ts_date,
    ts_time,
    thread_ts_date: threadStart.ts_date,
    thread_ts_time: threadStart.ts_time,
    channel_id: threadStart.channel_id || '',
    team_id: threadStart.team_id,
    user_id: threadStart.user_id,
    user_type: 'human',
    time_utc: UtcNowTimestamptz(),
  };

  return new SlackContext(slackContext);
}

export async function getReactionItemContext(
  client: WebClient,
  eventBody: any,
): Promise<SlackContext> {
  const item = eventBody?.event?.item || {};

  console.log(`reactionItemContext: ${JSON.stringify(item)}`);
  const { date: ts_date, time: ts_time } = parseSlackTs(item.ts || '0.0');
  const { date: thread_ts_date, time: thread_ts_time } = parseSlackTs(item.thread_ts || '0.0');

  const context = {
    ts_date,
    ts_time,
    thread_ts_date,
    thread_ts_time,
    channel_id: item.channel,
    channel_name: '',
    channel_type: '',
    team_id: item.team,
    user_id: item.user,
    time_utc: item.event_time_utc,
  };
  return new SlackContext(context);
}

export function tsToTimestamptz(ts: string): string {
  if (ts) {
    // get the part before the "."
    const unixtime = parseInt(ts.split('.')[0]);
    const event_time_utc = new Date(unixtime * 1000).toLocaleString('en-US', { timeZone: 'UTC' });
    return event_time_utc;
  }
  return '';
}

export function unixtimeToTimestamptz(unixtime: number): string | null {
  if (unixtime) {
    const event_time_utc = new Date(unixtime * 1000).toLocaleString('en-US', { timeZone: 'UTC' });
    return event_time_utc;
  }
  return null;
}

export function UtcNowTimestamptz(): string {
  const utcNow = new Date().toLocaleString('en-US', { timeZone: 'UTC' });
  return utcNow;
}

export function timeSecondsToMs(time_diff: number): number {
  const time_diff_int = parseInt((time_diff * 1000).toString());
  return time_diff_int;
}

export function isUserAdmin(app: any, user_id: string): void {
  try {
    const user_info = app.client.users_info({ user: user_id });
    const is_admin = user_info.user.is_admin;
    if (is_admin) {
      console.log(`User ${user_id} is an admin.`);
    } else {
      console.log(`User ${user_id} is not an admin.`);
    }
  } catch (e) {
    console.error(`Error fetching user info: ${e}`);
  }
}

export function retrieveMessage(app: any, channel_id: string, message_ts: string): any {
  try {
    const result = app.client.conversations.history({
      channel: channel_id,
      inclusive: true,
      oldest: message_ts,
      limit: 1,
    });
    return result.messages[0];
  } catch (e) {
    console.error(`Error get_message(channel=${channel_id}, message_ts=${message_ts}): ${e}`);
  }
  return null;
}

export function eventContext(msg_body: any): any {
  const evt = msg_body.event;
  if (!evt) {
    return null;
  }
  return {
    team: evt.team,
    channel: evt.channel,
    message: evt.ts,
  };
}

export function messageDeepLink(msg_body: any): string {
  const src = eventContext(msg_body);
  return `https://slack.com/app_redirect?team=${src.team}&channel=${src.channel}&message_ts=${src.message}`;
}

export function messagePermalink(app: any, msg_body: any): string {
  const src = eventContext(msg_body);
  return app.client.chat.getPermalink({ channel: src.channel, message_ts: src.message }).permalink;
}

export function register_custom_event(app: any, event_type: string): void {
  try {
    const response = app.client.apiCall('events.register', { type: event_type });
    if (response.ok) {
      console.log(`Event ${event_type} registered successfully.`);
    } else {
      console.error(`Failed to register event ${event_type}. Error: ${response.error}`);
    }
  } catch (e) {
    console.error(`Error registering custom event: ${e}`);
  }
}

export function removeMessageAttrib(msg_body: any, attrib_name: string): any {
  if (msg_body.message && msg_body.message[attrib_name]) {
    delete msg_body.message[attrib_name];
  }
  return msg_body;
}

export function parseSlackTs(ts: string): { date: number; time: number } {
  const [date, time] = ts.split('.');
  return { date: parseInt(date), time: parseInt(time) };
}
