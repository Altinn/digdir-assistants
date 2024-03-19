import { ChatCompletionMessageParam } from "openai/resources";
import { envVar } from "../general";
import { azureOpenAI, openaiClient, chat_stream } from "../llm";

// const azureLlm = azureOpenAI();
const openaiLlm = openaiClient();

export async function translate(
  toBeTranslated: string,
  target_language_name: string,
  stream_callback: any,
): Promise<string> {
  let query_result: any = null;
  let translated = "";

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "You are ChatGPT, a helpful assistant.",
    },
    {
      role: "user",
      content: `Please translate the following to "${target_language_name}":\n\n${toBeTranslated}`,
    },
  ];

  if (typeof stream_callback === "function") {
    translated = await chat_stream(messages, stream_callback);
  } else {
    if (envVar("USE_AZURE_OPENAI_API") === 'true') {
      // query_result = await azureLlm.chat.completions.create({
      //   model: envVar('AZURE_OPENAI_DEPLOYMENT'),
      //   temperature: 0.1,
      //   messages: messages
      // });
    } else {
      query_result = await openaiLlm.chat.completions.create({
        model: envVar("OPENAI_API_MODEL_NAME"),
        temperature: 0.1,
        messages: messages,
      });
    }

    translated = query_result.choices[0].message.content;
  }

  return translated;
}
