import { App, ExpressReceiver, LogLevel, GenericMessageEvent, Block } from '@slack/bolt';
import { ChatUpdateResponse } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import { createServer } from 'http';
import { envVar, round, lapTimer, timeoutPromise } from '@digdir/assistant-lib';
import {
  getEventContext,
  timeSecondsToMs,
  getReactionItemContext,
  getThreadResponseContext,
  getChatUpdateContext,
} from './utils/slack';
import { userInputAnalysis, UserQueryAnalysis } from '@digdir/assistant-lib';
import { ragPipeline, RagPipelineResult } from '@digdir/assistant-lib';
import { botLog, BotLogEntry, updateReactions } from './utils/bot-log';
import { splitToSections, isNullOrEmpty } from '@digdir/assistant-lib';
import OpenAI from 'openai';
import { isNumber } from 'remeda';

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

// Listens to incoming messages
app.message(async ({ message, say }) => {
  if (envVar('DEBUG_SLACK') == 'true') {
    console.log('-- incoming slack message event payload --');
    console.log(JSON.stringify(message, null, 2));
  }

  const genericMsg = message as GenericMessageEvent;
  var srcEvtContext = getEventContext(genericMsg);
  var userInput = ((genericMsg as GenericMessageEvent).text || '').trim();

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

  if (analysisError != null) {
    const error_logEntry = BotLogEntry.create({
      slack_context: getEventContext(genericMsg as GenericMessageEvent),
      elapsed_ms: timeSecondsToMs(stage1Duration),
      step_name: 'stage1_analyze',
      payload: {
        bot_name: 'docs',
        original_user_query: userInput,
        error: analysisError,
      },
    });
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
  let analyze_logEntry = BotLogEntry.create({
    slack_context: srcEvtContext,
    elapsed_ms: timeSecondsToMs(stage1Duration),
    step_name: 'stage1_analyze',
    payload: {
      bot_name: 'docs',
      english_user_query: stage1Result.questionTranslatedToEnglish,
      original_user_query: userInput,
      user_query_language_code: stage1Result.userInputLanguageCode,
      user_query_language_name: stage1Result.userInputLanguageName,
      content_category: stage1Result.contentCategory,
    },
  });

  botLog(analyze_logEntry);

  if (!stage1Result.contentCategory.includes('Support Request')) {
    console.warn(
      `Message category was not a support request. Category: "${stage1Result.contentCategory}"`,
    );
  }

  let threadTs = srcEvtContext.ts;

  const busyReadingMsg = 'Reading Altinn Studio docs...';
  let willTranslateMsg = '';

  if (stage1Result.userInputLanguageCode === 'no') {
    willTranslateMsg = 'Oversetter til norsk snart...';
  } else {
    willTranslateMsg = `We will also translate this message to ${stage1Result.userInputLanguageName}.`;
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

  let translatedMsgCallback: any = null;
  let secThreadSayResult;
  let secondThreadTs = null;
  let payload = {};

  if (willTranslate(stage1Result)) {
    secThreadSayResult = await say({
      text: willTranslateMsg,
      thread_ts: threadTs,
    });
    secondThreadTs = {
      channel: secThreadSayResult.channel,
      ts: secThreadSayResult.ts,
    };
    translatedMsgCallback = updateSlackMsgCallback(app, secondThreadTs);
  }

  let ragWithTypesenseError: string | null = null;

  const ragStart = performance.now();
  let ragResponse: RagPipelineResult | null = null;

  try {
    ragResponse = await ragPipeline(
      stage1Result.questionTranslatedToEnglish,
      stage1Result.userInputLanguageName,
      updateSlackMsgCallback(app, firstThreadTs),
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
      relevant_urls: ragResponse.relevant_urls,
      not_loaded_urls: ragResponse.not_loaded_urls || [],
      rag_success: !!ragResponse.rag_success,
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
      original_user_query: userInput, // Assuming `userInput` is the variable holding the original user query
      error: ragWithTypesenseError,
      rag_success: false,
    };

    const error_logEntry = BotLogEntry.create({
      slack_context: getEventContext(genericMsg as GenericMessageEvent),
      elapsed_ms: timeSecondsToMs(lapTimer(ragStart)),
      step_name: 'rag_with_typesense',
      payload: payload,
    });
    await botLog(error_logEntry);

    await app.client.chat.postMessage({
      thread_ts: srcEvtContext.ts,
      channel: srcEvtContext.channel,
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

  try {
    finalResponse = await finalizeAnswer(
      app,
      firstThreadTs,
      ragResponse.english_answer || '',
      ragResponse,
      ragResponse.durations.total + stage1Duration - ragResponse.durations.translation,
    );
  } catch (e) {
    finalizeError = e;
    console.error(`Error attempting to finalize app reply ${e}`);
  }
  let rag_logEntry: BotLogEntry | undefined;

  if (finalizeError != null) {
    // Log the bot operation
    rag_logEntry = BotLogEntry.create({
      slack_context: getThreadResponseContext(srcEvtContext, firstThreadTs.ts),
      elapsed_ms: timeSecondsToMs(
        ragResponse.durations.total + stage1Duration - ragResponse.durations.translation,
      ),
      durations: ragResponse.durations,
      step_name: 'rag_with_typesense',
      payload: {
        error: finalizeError,
        ...payload,
      },
    });
  } else if (finalResponse != undefined) {
    // Log the bot operation
    rag_logEntry = BotLogEntry.create({
      slack_context: getChatUpdateContext(srcEvtContext, finalResponse),
      elapsed_ms: timeSecondsToMs(
        ragResponse.durations.total + stage1Duration - ragResponse.durations.translation,
      ),
      durations: ragResponse.durations,
      step_name: 'rag_with_typesense',
      payload: payload,
    });
  }
  if (rag_logEntry != undefined) botLog(rag_logEntry);

  // translation has already completed when we get here
  if (willTranslate(stage1Result)) {
    let translationResponse: ChatUpdateResponse | undefined;

    try {
      translationResponse = await finalizeAnswer(
        app,
        secondThreadTs,
        ragResponse.translated_answer || '',
        ragResponse,
        ragResponse.durations.translation,
      );
    } catch (e) {
      finalizeError = e;
    }

    if (finalizeError != null) {
      // Log the bot operation
      rag_logEntry = BotLogEntry.create({
        slack_context: getThreadResponseContext(srcEvtContext, firstThreadTs.ts),
        elapsed_ms: timeSecondsToMs(ragResponse.durations.translation),
        durations: ragResponse.durations,
        step_name: 'rag_translate',
        payload: {
          error: finalizeError,
          ...payload,
        },
      });
    } else if (finalResponse != undefined) {
      // Log the bot operation
      rag_logEntry = BotLogEntry.create({
        slack_context: getChatUpdateContext(srcEvtContext, finalResponse),
        elapsed_ms: timeSecondsToMs(ragResponse.durations.translation),
        durations: ragResponse.durations,
        step_name: 'rag_translate',
        payload: payload,
      });
    }
    if (rag_logEntry != undefined) botLog(rag_logEntry);
  }
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

  console.log('event:', JSON.stringify(eventBody));

  try {
    const itemContext = getReactionItemContext(eventBody);
    const context = {
      channel: itemContext.channel,
      timestamp: itemContext.ts,
    };

    const botInfo = await app.client.auth.test();
    const botId = botInfo.user_id;

    const eventUserId = eventBody?.body?.event?.item_user;
    if (envVar('LOG_LEVEL') === 'debug') {
      if (botId === eventUserId) {
        console.log('Reaction on message from Assistant, will update reactions in DB');
      } else {
        console.log('Reaction was for something else, ignoring.');
        return;
      }
    }

    const messageInfo = await app.client.reactions.get(context);
    const reactions = messageInfo?.message?.reactions || [];

    const dbLog = await updateReactions(itemContext, reactions);

    // console.log('reactions: ', JSON.stringify(reactions));

    if (
      eventBody?.body?.event?.type == 'reaction_added' &&
      eventBody?.body?.event?.reaction == 'stopwatch'
    ) {
      // Send a debug message
      await app.client.chat.postEphemeral({
        channel: itemContext.channel,
        thread_ts: itemContext.ts,
        user: eventBody?.body?.event?.user,
        text: 'Performance data',
        blocks: debugMessageBlocks(dbLog),
      });
    }
  } catch (e) {
    console.log(`Error fetching reactions: ${e}`);
  }
}

app.event('reaction_added', async (event) => {
  await handleReactionEvents(event);
});

app.event('reaction_removed', async (event) => {
  await handleReactionEvents(event);
});

function willTranslate(stage1_result: UserQueryAnalysis) {
  return stage1_result && stage1_result.userInputLanguageCode != 'en';
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

    const sections = splitToSections(contentChunks.join(''));

    const blocks = sections.map((paragraph, i) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: paragraph },
    }));

    console.log(
      `Partial response update for channel '${threadTs.channel}' ts ${
        threadTs.ts
      }, time: ${Date.now()}`,
    );

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
  threadTs: { channel?: string; ts?: string } | null,
  answer: string,
  ragResponse: any,
  duration: number,
): Promise<ChatUpdateResponse> {
  if (!threadTs?.channel || !threadTs.ts) {
    throw new Error('Slack message callback cannot be initialized without a valid channel or ts.');
  }

  const relevantSources = ragResponse.relevant_urls;

  const sections = splitToSections(answer);

  const blocks: any[] = sections
    .filter((section) => !isNullOrEmpty(section))
    .map((paragraph, i) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: paragraph },
    }));

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

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `Generated in ${duration.toFixed(
        1,
      )} seconds.\nPlease give us your feedback with a :+1: or :-1:`,
    },
  });

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
  const payload = botLog.payload;
  // Process and format source documents and not loaded URLs for debug messages
  let sourceList = '*Retrieved articles*\n';
  let notLoadedList = '';
  const knownPathSegment = 'https://docs.altinn.studio';

  payload.source_urls.forEach((url: string, i: number) => {
    const pathSegmentIndex = url.indexOf(knownPathSegment);
    if (pathSegmentIndex >= 0) {
      url =
        'https://docs.altinn.studio' + url.substring(pathSegmentIndex + knownPathSegment.length);
      url = url.substring(0, url.lastIndexOf('/')) + '/';
    }
    sourceList += `#${i + 1}: <${url}|${url.replace('https://docs.altinn.studio/', '')}>\n`;
  });

  payload.not_loaded_urls.forEach((url: string, i: number) => {
    notLoadedList += `#${i + 1}: <${url}|${url.replace('https://docs.altinn.studio/', '')}>\n`;
  });

  const debugBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Phrases generated for retrieval:\n> ${payload.search_queries.join('\n> ')}`,
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

  const server = createServer(expressReceiver.app);

  server.listen(process.env.PORT || 3000, () => {
    console.log(`Server is running on port ${process.env.PORT || 3000}`);
  });

  const socketModeHandler = new SocketModeClient({
    appToken: envVar('SLACK_APP_TOKEN'),
    logLevel: LogLevel.WARN,
  });
  await socketModeHandler.start();

  console.log('⚡️ Bolt app is running!');
})();
