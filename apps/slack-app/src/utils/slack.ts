import { GenericMessageEvent } from '@slack/bolt';
import { ChatUpdateResponse } from '@slack/web-api';
import { Data } from 'dataclass';

export class SlackContext extends Data {
  ts: string = '';
  thread_ts: string = '';
  channel: string = '';
  team: string = '';
  user: string = '';
  time_utc: string = '';
}

export function getEventContext(evt: GenericMessageEvent): SlackContext {
  const context = SlackContext.create({
    ts: evt.ts,
    thread_ts: evt.thread_ts,
    channel: evt.channel,
    team: evt.team,
    user: evt.user,
    time_utc: tsToTimestamptz(evt.ts),
  });
  return context;
}

export function getChatUpdateContext(
  threadStart: SlackContext,
  evt: ChatUpdateResponse,
): SlackContext {
  const context = SlackContext.create({
    ts: evt.ts,
    thread_ts: threadStart.ts,
    channel: evt.channel,
    team: threadStart.team,
    user: threadStart.user,
    time_utc: UtcNowTimestamptz(),
  });
  return context;
}

export function getThreadResponseContext(item: SlackContext, responseTs: string): SlackContext {
  const context = SlackContext.create({
    ts: responseTs,
    thread_ts: item.thread_ts,
    channel: item.channel,
    team: item.team,
    user: item.user,
    time_utc: UtcNowTimestamptz(),
  });
  context.ts = responseTs;
  return context;
}

export function getReactionItemContext(eventBody: any): SlackContext {
  const item = eventBody?.event?.item || {};
  const context = SlackContext.create({
    ts: item.ts,
    thread_ts: item.thread_ts,
    channel: item.channel,
    team: item.team,
    user: item.user,
    time_utc: item.event_time_utc,
  });
  return context;
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
