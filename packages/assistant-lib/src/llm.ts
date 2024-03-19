import { z } from "zod";
import { OpenAI } from "openai";
import { ChatCompletionMessageParam } from "openai/resources";
import { AzureKeyCredential, OpenAIClient as AzureOpenAI } from "@azure/openai";
import Groq from "groq-sdk";

import { envVar, lapTimer } from "./general";
import { isNullOrEmpty } from "./markdown";

const JsonExtractionSchema = z.object({
  json_dict: z.record(z.any()),
  response_json_removed: z.string(),
});

type JsonExtraction = z.infer<typeof JsonExtractionSchema>;

export function extract_json_from_response(
  response: string,
  json_doc_keyword: string,
): JsonExtraction {
  if (response.toLowerCase().includes(json_doc_keyword.toLowerCase())) {
    const keyword_start = response
      .toLowerCase()
      .indexOf(json_doc_keyword.toLowerCase());
    const json_doc_start = keyword_start + json_doc_keyword.length;
    let json_str = response.substring(json_doc_start).trim();

    if (
      json_str.startsWith("```") &&
      json_str.endsWith("```") &&
      json_str.includes("\n")
    ) {
      json_str = json_str
        .substring(json_str.indexOf("\n"), json_str.length - 3)
        .trim();
    }

    const response_json_removed = response.substring(0, keyword_start).trim();
    console.log(`json_doc:\n${json_str}`);

    const json_dict = JSON.parse(json_str);
    return JsonExtractionSchema.parse({ json_dict, response_json_removed });
  }

  return JsonExtractionSchema.parse({
    json_dict: {},
    response_json_removed: response,
  });
}

export function azureOpenAI() {
  const azureOpenAI = new AzureOpenAI(
    envVar("AZURE_OPENAI_API_URL"),
    new AzureKeyCredential(envVar("AZURE_OPENAI_API_KEY")),
    {
      endpoint: envVar("AZURE_OPENAI_API_URL"),
      apiVersion: envVar("AZURE_OPENAI_VERSION"),
    },
  );
  return azureOpenAI;
}

export function openaiClient(): OpenAI {
  const openAI = new OpenAI({
    apiKey: envVar("OPENAI_API_KEY"),
  });
  return openAI;
}

export function groqClient(): Groq {
  const groq = new Groq({
    apiKey: envVar("GROQ_API_KEY"),
    baseURL: envVar("GROQ_API_URL"),
  });
  return groq;
}

export async function chat_stream(
  messages: Array<ChatCompletionMessageParam>,
  callback: (arg0: string) => void,
  callback_interval_seconds = 2.0,
): Promise<string> {
  let content_so_far = "";
  let latest_chunk = "";
  let chunk_count = 0;
  let last_callback = performance.now();

  if (typeof callback !== "function") {
    throw new Error("Chat stream callback is not a function.");
  }

  let llm_client: OpenAI;

  if (envVar("USE_AZURE_OPENAI_API") === true) {
    console.error("WHY ARE YOU HERE?");
    // console.log(`chat_stream - azure deployment: ${envVar('AZURE_OPENAI_DEPLOYMENT')}`);

    // llm_client = azure_client();
    // const stream = await llm_client.chat.completions.create({
    //     model: envVar('AZURE_OPENAI_DEPLOYMENT'),
    //     temperature: 0.1,
    //     messages: messages,
    //     stream: true,
    // });

    // for await (const chunk of stream) {
    //     const content = (chunk && chunk.choices) ? chunk.choices[0].delta.content : null;

    //     if (content !== null) {
    //         latest_chunk += content;
    //         content_so_far += content;
    //         chunk_count += 1;
    //     }

    //     if (lapTimer(last_callback) >= callback_interval_seconds ||
    //         (chunk && chunk.choices && chunk.choices.length > 0
    //             && chunk.choices[0].finish_reason === 'stop')) {
    //         last_callback = performance.now();
    //         callback(latest_chunk);
    //         latest_chunk = '';
    //     }
    // }
  } else {
    console.log(`chat_stream - model: ${envVar("OPENAI_API_MODEL_NAME")}`);
    llm_client = openaiClient();
    const stream = await llm_client.chat.completions.create({
      model: envVar("OPENAI_API_MODEL_NAME"),
      temperature: 0.1,
      messages: messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content =
        chunk && chunk.choices ? chunk.choices[0].delta.content : null;

      if (!isNullOrEmpty(content)) {
        latest_chunk += content;
        content_so_far += content;
        chunk_count += 1;
      }

      if (
        lapTimer(last_callback) >= callback_interval_seconds ||
        (chunk &&
          chunk.choices &&
          chunk.choices.length > 0 &&
          chunk.choices[0].finish_reason === "stop")
      ) {
        last_callback = performance.now();
        callback(latest_chunk);
        latest_chunk = "";
      }
    }
  }

  return content_so_far;
}
