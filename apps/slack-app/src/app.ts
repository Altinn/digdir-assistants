import express from 'express';
import path from 'path';
import { App, ExpressReceiver, LogLevel, GenericMessageEvent, Block } from '@slack/bolt';
import { ChatUpdateResponse, ReactionsGetResponse } from '@slack/web-api';
// import { SocketModeClient } from '@slack/socket-mode';
import { createServer } from 'http';
import {
  getEventContext,
  timeSecondsToMs,
  getReactionItemContext,
  getThreadResponseContext,
  getChatUpdateContext,
  SlackApp,
  SlackContext,
} from './utils/slack';
import { lookupConfig } from './utils/bot-config';
import { envVar, round, lapTimer, timeoutPromise } from '@digdir/assistant-lib';
import { userInputAnalysis, UserQueryAnalysis } from '@digdir/assistant-lib';
import { ragPipeline, qaTemplate } from '@digdir/assistant-lib';
import { stripCodeBlockLang, isNullOrEmpty } from '@digdir/assistant-lib';
import { botLog, BotLogEntry, updateReactions } from './utils/bot-log';
import OpenAI from 'openai';
import { isNumber } from 'remeda';
import { RagPipelineResult } from '@digdir/assistant-lib';
import {markdownToBlocks} from '@bdb-dd/mack';

const expressReceiver = new ExpressReceiver({
  signingSecret: envVar('SLACK_BOT_SIGNING_SECRET'),
});
const app = new App({
  token: envVar('SLACK_BOT_TOKEN'),
  signingSecret: envVar('SLACK_BOT_SIGNING_SECRET'),
  receiver: expressReceiver,
  appToken: envVar('SLACK_APP_TOKEN'),
  logLevel: LogLevel.INFO,
});

const slackApp: SlackApp = new SlackApp({
  app_id: '',
  bot_name: 'docs',
});

async function ensureBotContext() {
  if (slackApp.app_id == '') {
    const appInfo = await app.client.auth.test();
    slackApp.app_id = appInfo.user_id || '';
  }
  if (slackApp.app_id == '') {
    console.error(`app_id not set!`);
  }
}

// Listens to incoming messages
app.message(async ({ message, say }) => {
  if (envVar('DEBUG_SLACK') == 'true') {
    console.log('-- incoming slack message event payload --');
    console.log(JSON.stringify(message, null, 2));
  }

  await ensureBotContext();

  const genericMsg = message as GenericMessageEvent;
  var srcEvtContext = await getEventContext(app.client, genericMsg);

  var userInput = (genericMsg.text || '').trim();

  if (genericMsg.subtype == 'message_changed') {
    // ignoring message changes in channels
    // - could regenerate responses in a non-shared context, as ChatGPT does
    return;
  }

  if (!isNullOrEmpty(genericMsg.thread_ts)) {
    // we don't support replying to thread messages
    return;
  }

  if (isNullOrEmpty(userInput)) {
    console.log('Ignoring empty userInput.');
    return;
  }

  if (genericMsg.subtype === 'message_deleted') {
    console.log('Ignoring "Message deleted" event.');
    return;
  }

  // we have eliminated as many message types as we can

  const ignoreWhenNotTagged = await lookupConfig(
    slackApp,
    srcEvtContext,
    'ignoreWhenNotTagged',
    true,
  );

  const queryRelaxCustom = await lookupConfig(slackApp, srcEvtContext, 'prompt.rag.queryRelax', '');

  const promptRagQueryRelax =
    `You have access to a search API that returns relevant documentation.

    Your task is to generate an array of up to 7 search queries that are relevant to this question. 
    Use a variation of related keywords and synonyms for the queries, trying to be as general as possible.
    Include as many queries as you can think of, including and excluding terms.
    For example, include queries like ['keyword_1 keyword_2', 'keyword_1', 'keyword_2'].
    Be creative. The more queries you include, the more likely you are to find relevant results.
    
  ` + queryRelaxCustom;

  const promptRagGenerateCustom = await lookupConfig(
    slackApp,
    srcEvtContext,
    'prompt.rag.generate',
    '',
  );
  const promptRagGenerate = qaTemplate(promptRagGenerateCustom || '');

  if (envVar('LOG_LEVEL') == 'debug') {
    console.log(`slackApp:\n${JSON.stringify(slackApp)}`);
    console.log(`slackContext:\n${JSON.stringify(srcEvtContext)}`);
  }

  if (genericMsg.text && genericMsg.text.includes(`<@${slackApp.app_id}>`)) {
    if (envVar('LOG_LEVEL') == 'debug') {
      console.log('Bot was mentioned in the message.');
    }
  } else {
    if (ignoreWhenNotTagged == true && genericMsg.channel_type != 'im') {
      if (envVar('LOG_LEVEL') == 'debug') {
        console.log(
          'Bot was not mentioned in channel message and ignoreWhenNotTagged is true, ignoring message.',
        );
      }
      return;
    }
  }

  // #1 - Response with "Thinking..."
  let firstThreadTs: any = await say({
    text: 'Thinking...',
    thread_ts: genericMsg.ts,
  });

  let queryAnalysisResult: UserQueryAnalysis | unknown = null;
  let analysisError = null;

  var start = performance.now();

  try {
    // guard with a hard 10 second timeout
    queryAnalysisResult = await Promise.race([
      userInputAnalysis(userInput),
      timeoutPromise(envVar('LLM_TIMEOUT', 10000)),
    ]);
  } catch (error) {
    if (error instanceof Error) {
      analysisError = error.message;
    } else {
      analysisError = JSON.stringify(error);
    }
    console.error(`stage1_analyze ERROR: ${analysisError}`);
  }
  const stage1Duration = round(lapTimer(start));

  srcEvtContext = await getEventContext(app.client, genericMsg);

  if (analysisError != null) {
    const error_logEntry: BotLogEntry = {
      slack_context: srcEvtContext,
      slack_app: slackApp,
      elapsed_ms: timeSecondsToMs(stage1Duration),
      step_name: 'stage1_analyze',
      content: {
        bot_name: 'docs',
        original_user_query: userInput,
        error: analysisError,
      },
    };
    try {
      await botLog(error_logEntry);
    } catch (dblog_error) {
      console.error(`Error occurred while logging an error to DB:\n${JSON.stringify(dblog_error)}`);
    }

    try {
      await app.client.chat.update({
        channel: firstThreadTs.channel,
        ts: firstThreadTs.ts,
        text: `An unexpected error occurred while analyzing your query.\nPlease try to rephrase your request.`,
        as_user: true,
      });
    } catch (e) {
      console.log(`Error attempting to update app reply ${e}`);
    }
    // can't process this query any further
    return;
  }

  if (envVar('LOG_LEVEL') == 'debug') {
    console.log(`stage1_analyze results:\n${JSON.stringify(queryAnalysisResult, null, 2)}`);
  }

  const stage1Result = (queryAnalysisResult as UserQueryAnalysis)!;
  let analyze_logEntry = {
    slack_context: {
      ...srcEvtContext,
      user_type: 'human',
    },
    slack_app: slackApp,
    elapsed_ms: timeSecondsToMs(stage1Duration),
    step_name: 'stage1_analyze',
    content: {
      bot_name: 'docs',
      english_user_query: stage1Result.questionTranslatedToEnglish,
      original_user_query: userInput,
      user_query_language_code: stage1Result.userInputLanguageCode,
      user_query_language_name: stage1Result.userInputLanguageName,
      content_category: stage1Result.contentCategory,
    },
    content_type: 'docs_user_query',
  };

  console.log(`analyze_logEntry: ${JSON.stringify(analyze_logEntry)}`);

  botLog(analyze_logEntry);

  if (!stage1Result.contentCategory.includes('Support Request')) {
    console.warn(
      `Message category was not a support request. Category: "${stage1Result.contentCategory}"`,
    );
  }

  let threadTs = srcEvtContext.ts_date + '.' + srcEvtContext.ts_time;

  let busyReadingMsg = '';

  if (stage1Result.userInputLanguageCode === 'en') {
    busyReadingMsg = 'Reading Altinn 3 documentation...';
  } else if (stage1Result.userInputLanguageCode === 'no') {
    busyReadingMsg = 'Leser Altinn 3 dokumentasjon...';
  } else {
    busyReadingMsg = `Reading Altinn 3 documentation. The reply will be translated to ${stage1Result.userInputLanguageName}.`;
  }

  if (firstThreadTs != null) {
    try {
      await app.client.chat.update({
        channel: firstThreadTs.channel,
        ts: firstThreadTs.ts,
        text: busyReadingMsg,
        as_user: true,
      });
    } catch (e) {
      console.log(`Error attempting to update app reply ${e}`);
    }
  } else {
    firstThreadTs = await say({ text: busyReadingMsg, thread_ts: threadTs });
  }

  let originalMsgCallback: any = null;
  let translatedMsgCallback: any = null;
  let payload = {};

  if (willTranslate(stage1Result)) {
    translatedMsgCallback = updateSlackMsgCallback(app, firstThreadTs);
  } else {
    originalMsgCallback = updateSlackMsgCallback(app, firstThreadTs);
  }

  let ragWithTypesenseError: string | null = null;

  const ragStart = performance.now();
  let ragResponse: RagPipelineResult | null = null;

  try {
    ragResponse = await ragPipeline(
      stage1Result.questionTranslatedToEnglish,
      stage1Result.userInputLanguageName,
      promptRagQueryRelax || '',
      promptRagGenerate || '',
      originalMsgCallback,
      translatedMsgCallback,
    );

    ragResponse.durations.analyze = stage1Duration;

    payload = {
      bot_name: 'docs',
      original_user_query: ragResponse.original_user_query || '',
      english_user_query: ragResponse.english_user_query || '',
      user_query_language_code: stage1Result.userInputLanguageCode || '',
      user_query_language_name: ragResponse.user_query_language_name || '',
      english_answer: ragResponse.english_answer || '',
      translated_answer: ragResponse.translated_answer || '',
      search_queries: ragResponse.search_queries,
      source_urls: ragResponse.source_urls,
      source_documents: ragResponse.source_documents || [],
      relevant_urls: ragResponse.relevant_urls,
      not_loaded_urls: ragResponse.not_loaded_urls || [],
      rag_success: !!ragResponse.rag_success,
      prompts: {
        queryRelax: promptRagQueryRelax || '',
        generate: promptRagGenerate || '',
      },
    };
  } catch (e) {
    if (e instanceof OpenAI.APIConnectionError) {
      ragWithTypesenseError = `OpenAI error: ${e}`;
    } else if (e instanceof OpenAI.RateLimitError) {
      ragWithTypesenseError = "OpenAI service is busy right now, let's try again";
    } else if (e instanceof OpenAI.APIError) {
      ragWithTypesenseError = `OpenAI API error: ${e}`;
    } else {
      ragWithTypesenseError = `Error: ${e}`;
    }
  }

  if (ragWithTypesenseError) {
    console.log(`\n\nERROR running RAG: ${ragWithTypesenseError}\n\n`);

    payload = {
      bot_name: 'docs',
      original_user_query: userInput,
      error: ragWithTypesenseError,
      rag_success: false,
    };

    const error_logEntry = {
      slack_context: await getEventContext(app.client, genericMsg as GenericMessageEvent),
      slack_app: slackApp,
      elapsed_ms: timeSecondsToMs(lapTimer(ragStart)),
      step_name: 'rag_with_typesense',
      content: payload,
      content_type: 'docs_bot_reply',
    };
    await botLog(error_logEntry);

    await app.client.chat.postMessage({
      thread_ts: srcEvtContext.ts_date + '.' + srcEvtContext.ts_time,
      channel: srcEvtContext.channel_id,
      text: ragWithTypesenseError,
    });

    return;
  }

  // ragResponse null guard
  if (!ragResponse) {
    console.error("We shouldn't get here, means we are missing an error handler.");
    return;
  }

  let finalizeError = null;
  let finalResponse: ChatUpdateResponse | undefined;

  await new Promise((resolve) => setTimeout(resolve, 1500));

  try {
    finalResponse = await finalizeAnswer(
      app,
      ragResponse,
      firstThreadTs,
      ragResponse.durations.total,
      willTranslate(stage1Result),
    );
  } catch (e) {
    finalizeError = e;
    console.error(`Error attempting to finalize app reply ${e}`);
  }
  let rag_logEntry: BotLogEntry | undefined;

  if (finalizeError != null) {
    // Log the bot operation
    rag_logEntry = {
      slack_context: await getThreadResponseContext(app.client, srcEvtContext, firstThreadTs.ts),
      slack_app: slackApp,
      elapsed_ms: timeSecondsToMs(ragResponse.durations.total),
      durations: ragResponse.durations,
      step_name: 'rag_with_typesense',
      content: {
        ...payload,
        error: finalizeError,
      },
      content_type: 'docs_bot_error',
    };
  } else if (finalResponse != undefined) {
    // Log the bot operation
    rag_logEntry = {
      slack_context: await getChatUpdateContext(app.client, srcEvtContext, finalResponse),
      slack_app: slackApp,
      elapsed_ms: timeSecondsToMs(ragResponse.durations.total),
      durations: ragResponse.durations,
      step_name: 'rag_with_typesense',
      content: payload,
      content_type: 'docs_bot_reply',
    };
  }
  if (rag_logEntry != undefined) botLog(rag_logEntry);
});

async function handleReactionEvents(eventBody: any) {
  if (envVar('LOG_LEVEL') === 'debug') {
    console.log('handle reactions: eventBody: ', JSON.stringify(eventBody));
  }

  const channelInfo = await app.client.conversations.info({
    channel: eventBody?.body?.event?.item?.channel,
  });

  if (channelInfo == null || !channelInfo.ok) {
    console.log(`Error: App not in channel ${eventBody?.body?.event?.item?.channel}`);
    return;
  }

  if (envVar('LOG_LEVEL') == 'debug') {
    console.log('event:', JSON.stringify(eventBody));
  }

  var itemContext: SlackContext;
  var messageInfo: ReactionsGetResponse;

  try {
    itemContext = await getReactionItemContext(app.client, eventBody);
    const context = {
      team: itemContext.team_id,
      channel: itemContext.channel_id,
      timestamp: itemContext.ts_date + '.' + itemContext.ts_time,
    };

    const botInfo = await app.client.auth.test();
    const botId = botInfo.user_id;

    const eventUserId = eventBody?.body?.event?.item_user;
    if (envVar('LOG_LEVEL') === 'debug') {
      if (botId === eventUserId) {
        console.log('Reaction on message from Assistant, will update reactions in DB');
      } else {
        console.log(
          `Reaction was for something else, ignoring. Bot ID: ${botId}, reaction was on item with item_user: ${eventUserId}`,
        );
        return;
      }
    }

    messageInfo = await app.client.reactions.get(context);
  } catch (e) {
    console.log(`Error fetching reactions: ${e}`);
  }

  if (messageInfo! == null || itemContext! == null) {
    console.log(
      `Error fetching reactions - messageInfo: ${JSON.stringify(messageInfo!)}\nitemContext: ${JSON.stringify(itemContext!)}.`,
    );
    return;
  }

  try {
    const reactions = messageInfo?.message?.reactions || [];

    const dbLog = await updateReactions(slackApp, itemContext, reactions);

    if (envVar('LOG_LEVEL') == 'info' || envVar('LOG_LEVEL') == 'debug') {
      console.log(
        `updated reactions:\ncontext: ${JSON.stringify(itemContext!)}\nreactions: ${JSON.stringify(reactions)}`,
      );
    }

    if (
      eventBody?.body?.event?.type == 'reaction_added' &&
      eventBody?.body?.event?.reaction == 'stopwatch'
    ) {
      // Send a debug message
      await app.client.chat.postEphemeral({
        channel: itemContext.channel_id,
        thread_ts: itemContext.ts_date + '.' + itemContext.ts_time,
        user: eventBody?.body?.event?.user,
        text: 'Performance data',
        blocks: debugMessageBlocks(dbLog!),
      });
    }
  } catch (e) {
    console.log(`Error updating reactions in db: ${e}`);
  }
}

app.event('reaction_added', async (event) => {
  await handleReactionEvents(event);
});

app.event('reaction_removed', async (event) => {
  await handleReactionEvents(event);
});

function willTranslate(stage1_result: UserQueryAnalysis): boolean {
  return stage1_result?.userInputLanguageCode != 'en';
}

function updateSlackMsgCallback(
  slackApp: App,
  threadTs: { channel?: string; ts?: string } | null,
): (arg0: string) => void {
  const contentChunks: string[] = [];

  if (!threadTs?.channel || !threadTs.ts) {
    throw new Error('Slack message callback cannot be initialized without a valid channel or ts.');
  }

  const inner = async (partialResponse: string) => {
    if (!threadTs?.channel || !threadTs.ts) {
      throw new Error(
        'Slack message callback cannot be initialized without a valid channel or ts.',
      );
    }

    if (partialResponse == undefined) {
      console.warn('partialResponse is undefined');
    }

    if (partialResponse == null) {
      console.warn('partialResponse is null');
    }

    contentChunks.push(partialResponse);

    const blocks = await markdownToBlocks(stripCodeBlockLang(contentChunks.join('')));

    if (envVar('LOG_LEVEL') == 'debug') {
      console.log(
        `Partial response update for channel '${threadTs.channel}' ts ${
          threadTs.ts
        }, time: ${Date.now()}`,
      );
    }

    try {
      await slackApp.client.chat.update({
        channel: threadTs.channel,
        ts: threadTs.ts,
        text: '...',
        blocks: blocks,
        as_user: true,
      });
    } catch (e) {
      console.log(`Error attempting to update Slack message ${e}`);
    }
  };

  return inner;
}

async function finalizeAnswer(
  app: App,
  ragResponse: RagPipelineResult,
  threadTs: { channel?: string; ts?: string } | null,
  duration: number,
  translation: boolean,
): Promise<ChatUpdateResponse> {
  if (!threadTs?.channel || !threadTs.ts) {
    throw new Error('Slack message callback cannot be initialized without a valid channel or ts.');
  }

  const relevantSources = ragResponse.relevant_urls;

  const blocks = await markdownToBlocks(
    translation ? ragResponse.translated_answer : ragResponse.english_answer,
  );

  if (relevantSources.length > 0) {
    const linksMarkdown = relevantSources
      .map((source: any) => `<${source.url}|${source.title}>`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `For more information:\n${linksMarkdown}`,
      },
    });
  }

  if (translation && ragResponse.user_query_language_name == 'Norwegian') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Svartid: ${duration?.toFixed(1)} sek.\nGi gjerne tilbakemelding med :+1: :-1: eller :stopwatch: for info om kilder.`,
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Generated in ${duration?.toFixed(1)} seconds.\nPlease give us your feedback with :+1: :-1:, or :stopwatch: for more info.`,
      },
    });
  }

  const responseTs = await app.client.chat.update({
    channel: threadTs.channel,
    ts: threadTs.ts,
    text: 'Final answer',
    blocks: blocks,
    as_user: true,
  });
  return responseTs;
}

function debugMessageBlocks(botLog: BotLogEntry): Array<Block> {
  const content = botLog.content as any;
  // Process and format source documents and not loaded URLs for debug messages
  let sourceList = '*Retrieved articles*\n';
  let notLoadedList = '';
  const knownPathSegment = 'https://docs.altinn.studio';

  content.source_urls.forEach((url: string, i: number) => {
    const pathSegmentIndex = url.indexOf(knownPathSegment);
    if (pathSegmentIndex >= 0) {
      url =
        'https://docs.altinn.studio' + url.substring(pathSegmentIndex + knownPathSegment.length);
      url = url.substring(0, url.lastIndexOf('/')) + '/';
    }
    sourceList += `#${i + 1}: <${url}|${url.replace('https://docs.altinn.studio/', '')}>\n`;
  });

  content.not_loaded_urls.forEach((url: string, i: number) => {
    notLoadedList += `#${i + 1}: <${url}|${url.replace('https://docs.altinn.studio/', '')}>\n`;
  });

  const debugBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Phrases generated for retrieval:\n> ${content.search_queries.join('\n> ')}`,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: sourceList },
    },
    ...(notLoadedList.length > 0
      ? [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Retrieved, but not used:*\n${notLoadedList}`,
            },
          },
        ]
      : []),
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Processing times (sec):\n\`\`\`\n${JSON.stringify(botLog.durations, null, 2)}\`\`\``,
      },
    },
  ];
  return debugBlocks;
}

(async () => {
  // check important envVars
  const _LLM_TIMEOUT = Number(envVar('LLM_TIMEOUT', 10000));
  if (_LLM_TIMEOUT !== null && isNaN(_LLM_TIMEOUT)) {
    throw new Error(
      `_LLM_TIMEOUT must be a number or a string that represents a number. Current value: ${_LLM_TIMEOUT} `,
    );
  }
  if (isNumber(_LLM_TIMEOUT) && Number(_LLM_TIMEOUT) < 6000) {
    throw new Error('_LLM_TIMEOUT must be at least 6000 ms.');
  }

  const rootApp = express();
  rootApp.use('/bolt', expressReceiver.app);
  rootApp.use('/', express.static(path.join(__dirname, '../../../admin/dist/')));

  const server = createServer(rootApp);

  server.listen(process.env.PORT || 3000, () => {
    console.log(`Server is running on port ${process.env.PORT || 3000}`);
  });

  // const socketModeHandler = new SocketModeClient({
  //   appToken: envVar('SLACK_APP_TOKEN'),
  //   logLevel: LogLevel.WARN,
  // });
  // await socketModeHandler.start();

  console.log('⚡️ Bolt app is running!');
})();
