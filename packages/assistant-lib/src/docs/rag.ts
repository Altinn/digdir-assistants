import { queryRelaxation } from "./query-relaxation";
import {
  lookupSearchPhrasesSimilar,
  retrieveAllByUrl,
} from "./retrieval-typesense";
import { translate } from "./translate";
import { isValidUrl, lapTimer, scopedEnvVar, round } from "../general";
import {} from "./translate";
import { chat_stream, openaiClient } from "../llm";
import { typesenseConfig } from "../config/typesense";
import axios from "axios";
import { z } from "zod";
import { flatMap } from "remeda";
import * as yaml from "js-yaml";

const stage_name = "DOCS_QA_RAG";
const envVar = scopedEnvVar(stage_name);
const cfg = typesenseConfig();
// const azureClient = azure_client();
const _openaiClient = openaiClient();

const RagContextRefsSchema = z.object({
  source: z.string().min(1),
});

const RagGenerateResultSchema = z.object({
  helpful_answer: z.string(),
  i_dont_know: z.boolean(),
  relevant_contexts: z.array(RagContextRefsSchema),
});

const RagPromptSchema = z.object({
  queryRelax: z.string(),
  generate: z.string(),
});
export type RagPrompt = z.infer<typeof RagPromptSchema>;

const RagPipelineParamsSchema = z.object({
  translated_user_query: z.string(),
  original_user_query: z.string(),
  user_query_language_name: z.string(),
  promptRagQueryRelax: z.string(),
  promptRagGenerate: z.string(),
  docsCollectionName: z.string(),
  phrasesCollectionName: z.string(),
  stream_callback_msg1: z.any().nullable(),
  stream_callback_msg2: z.any().nullable(),
  maxResponseTokenCount: z.number().optional(),
  streamCallbackFreqSec: z.number().optional(),
});

export type RagPipelineParams = z.infer<typeof RagPipelineParamsSchema>;

const RagPipelineResultSchema = z.object({
  original_user_query: z.string(),
  english_user_query: z.string(),
  user_query_language_name: z.string(),
  english_answer: z.string(),
  translated_answer: z.string(),
  rag_success: z.boolean(),
  search_queries: z.array(z.string()),
  source_urls: z.array(z.string()),
  source_documents: z.array(z.any()),
  relevant_urls: z.array(z.string()),
  not_loaded_urls: z.array(z.string()),
  durations: z.record(z.string(), z.number()),
  prompts: RagPromptSchema.optional(),
  docsCollection: z.string().optional(),
  phrasesCollection: z.string().optional(),
});

export type RagPipelineResult = z.infer<typeof RagPipelineResultSchema>;

export async function ragPipeline(
  params: RagPipelineParams,
): Promise<RagPipelineResult> {
  const durations: any = {
    total: 0,
    analyze: 0,
    generate_searches: 0,
    execute_searches: 0,
    phrase_similarity_search: 0,
    colbert_rerank: 0,
    rag_query: 0,
    translation: 0,
  };

  if (envVar("MAX_CONTEXT_DOC_COUNT") == 0) {
    throw new Error("MAX_CONTEXT_DOC_COUNT is set to 0");
  }
  const total_start = performance.now();
  var start = total_start;

  const extract_search_queries = await queryRelaxation(
    params.translated_user_query,
    params.promptRagQueryRelax,
  );
  durations.generate_searches = round(lapTimer(total_start));

  if (envVar("LOG_LEVEL") === "debug-relaxation") {
    console.log(
      "Extracted search queries:",
      JSON.stringify(extract_search_queries),
    );
  }
  start = performance.now();
  const search_phrase_hits = await lookupSearchPhrasesSimilar(
    params.phrasesCollectionName,
    extract_search_queries,
    "original",
  );
  durations["phrase_similarity_search"] = round(lapTimer(start));

  if (envVar("LOG_LEVEL") === "debug-relaxation") {
    console.log(
      "Phrase similarity search:",
      JSON.stringify(search_phrase_hits),
    );
  }
  start = performance.now();
  const search_response = await retrieveAllByUrl(
    params.docsCollectionName,
    search_phrase_hits,
  );
  durations["execute_searches"] = round(lapTimer(start));

  if (envVar("LOG_LEVEL") === "debug-relaxation") {
    console.log("Search response:", JSON.stringify(search_response));
  }
  const searchHits = flatMap(search_response.results, (result: any) =>
    flatMap(result.grouped_hits, (grouped_hit: any) =>
      grouped_hit.hits.map((hit: any) => {
        // console.log('hits:', JSON.stringify(hit));
        return {
          id: hit.document.id,
          url: hit.document.url_without_anchor,
          content_markdown: hit.document.content_markdown || "",
        };
      }),
    ),
  );

  if (searchHits.length == 0) {
    console.error("No search hits returned from Typesense!");
  } else {
    if (envVar("LOG_LEVEL") === "debug") {
      console.log("search hits:", JSON.stringify(searchHits));
    }
  }

  let allUrls: string[] = [];
  let allDocs: any[] = [];
  let loadedDocs: any[] = [];
  let loadedUrls: string[] = [];
  let loadedSearchHits: any[] = [];
  let docIndex = 0;
  let docsLength = 0;

  // Make list of all markdown content
  while (docIndex < searchHits.length) {
    const searchHit = searchHits[docIndex];
    docIndex += 1;
    const uniqueUrl = searchHit.url;

    if (allUrls.includes(uniqueUrl)) {
      continue;
    }

    const docMd = searchHit.content_markdown;
    if (docMd.length === 0) {
      continue;
    }

    const loadedDoc = {
      page_content: docMd,
      metadata: {
        source: uniqueUrl,
      },
    };
    allDocs.push(loadedDoc);
    allUrls.push(uniqueUrl);
  }

  // Rerank results using ColBERT

  start = performance.now();
  let reranked: any[];
  const rerankUrl = envVar("COLBERT_API_URL");
  if (!isValidUrl(rerankUrl)) {
    throw new Error(
      `Environment variable 'COLBERT_API_URL' is invalid: '${rerankUrl}'`,
    );
  }

  const rerankData = {
    user_input: params.translated_user_query,
    documents: searchHits.map((document: any) =>
      document.content_markdown.substring(0, envVar("MAX_SOURCE_LENGTH")),
    ),
  };

  if (envVar("LOG_LEVEL") === "debug-rerank") {
    console.log(
      `Calling ${rerankUrl}, sending:\n${JSON.stringify(rerankData)}`,
    );
  }
  const rerankResponse = await axios.post(rerankUrl, rerankData);
  reranked = rerankResponse.data;

  if (envVar("LOG_LEVEL") === "debug-rerank") {
    console.log("ColBERT re-ranking results:");
    console.log(reranked);
  }

  // Re-order search-hits based on new ranking
  const searchHitsReranked = reranked.map((r) => searchHits[r.result_index]);

  durations.colbert_rerank = round(lapTimer(start));

  // Need to preserve order in documents list
  docIndex = 0;

  while (docIndex < searchHitsReranked.length) {
    const searchHit = searchHitsReranked[docIndex];
    docIndex += 1;
    const uniqueUrl = searchHit.url;

    if (loadedUrls.includes(uniqueUrl)) {
      continue;
    }

    let docMd = searchHit.content_markdown;

    const sourceDesc = "\n```\nSource URL: " + uniqueUrl + "\n```\n\n";

    console.log("Source desc: " + sourceDesc);

    let docTrimmed = docMd.substring(0, envVar("MAX_SOURCE_LENGTH"));
    if (docsLength + docTrimmed.length > envVar("MAX_CONTEXT_LENGTH")) {
      docTrimmed = docTrimmed.substring(
        0,
        envVar("MAX_CONTEXT_LENGTH") - docsLength - 20,
      );
    }

    if (docTrimmed.length === 0) {
      break;
    }

    const loadedDoc = {
      page_content: sourceDesc + docTrimmed,
      metadata: {
        source: uniqueUrl,
      },
    };
    if (envVar("LOG_LEVEL") === "debug") {
      console.log(
        `loaded markdown doc, length= ${docTrimmed.length}, url= ${uniqueUrl}`,
      );
    }

    docsLength += docTrimmed.length;
    loadedDocs.push(loadedDoc);
    loadedUrls.push(uniqueUrl);
    loadedSearchHits.push(searchHit);

    // TODO: add actual doc length, loaded doc length to dedicated lists and return

    if (
      docsLength >= envVar("MAX_CONTEXT_LENGTH") ||
      loadedDocs.length >= envVar("MAX_CONTEXT_DOC_COUNT")
    ) {
      console.log(`Limits reached, loaded ${loadedDocs.length} docs.`);
      break;
    }
  }

  let notLoadedUrls: string[] = [];
  for (const hit of searchHits) {
    const url = hit.url;
    if (!loadedUrls.includes(url) && !notLoadedUrls.includes(url)) {
      notLoadedUrls.push(url);
    }
  }

  console.log(
    `Starting RAG structured output chain, llm: ${envVar("OPENAI_API_MODEL_NAME")}`,
  );
  start = performance.now();
  let english_answer: string = "";
  let translated_answer: string = "";
  let rag_success = false;
  let relevant_sources: string[] = [];

  const contextYaml = yaml.dump(loadedDocs);
  const partialPrompt = params.promptRagGenerate;
  const fullPrompt = partialPrompt
    .replace("{context}", contextYaml)
    .replace("{question}", params.translated_user_query);

  if (envVar("LOG_LEVEL") == "debug") {
    console.log(`rag prompt:\n${partialPrompt}`);
  }

  if (typeof params.stream_callback_msg1 !== "function") {
    if (envVar("USE_AZURE_OPENAI_API") === "true") {
      // const chatResponse = await azureClient.chat.completions.create({
      //     model: envVar('AZURE_OPENAI_DEPLOYMENT'),
      //     temperature: 0.1,
      //     max_retries: 0,
      //     messages: messages
      // });
      // english_answer = chatResponse.choices[0].message.content;
    } else {
      console.log(
        `${stage_name} model name: ${envVar("OPENAI_API_MODEL_NAME")}`,
      );
      const chatResponse = await _openaiClient.chat.completions.create({
        model: envVar("OPENAI_API_MODEL_NAME"),
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content: fullPrompt,
          },
        ],
      });
      english_answer = chatResponse.choices[0].message.content || "";
    }
    translated_answer = english_answer;
    rag_success = true;
  } else {
    // OpenAI streaming
    english_answer = await chat_stream(
      [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: fullPrompt,
        },
      ],
      params.stream_callback_msg1,
      params.streamCallbackFreqSec || 2.0,
      params.maxResponseTokenCount,
    );
    translated_answer = english_answer;
    rag_success = true;
  }

  durations["rag_query"] = round(lapTimer(start));

  // Translation logic
  start = performance.now();
  const translation_enabled = true;

  if (
    translation_enabled &&
    rag_success &&
    params.user_query_language_name !== "English"
  ) {
    translated_answer = await translate(
      english_answer,
      params.user_query_language_name,
      params.stream_callback_msg2,
    );
  }

  durations["translation"] = round(lapTimer(start));
  durations["total"] = round(lapTimer(total_start));

  const response: RagPipelineResult = {
    original_user_query: params.original_user_query,
    english_user_query: params.translated_user_query,
    user_query_language_name: params.user_query_language_name,
    english_answer: english_answer || "",
    translated_answer: translated_answer || "",
    rag_success,
    search_queries: extract_search_queries?.searchQueries || [],
    source_urls: loadedUrls,
    source_documents: loadedDocs,
    relevant_urls: relevant_sources,
    not_loaded_urls: notLoadedUrls,
    durations,
    prompts: {
      queryRelax: params.promptRagQueryRelax || "",
      generate: params.promptRagGenerate || "",
    },
  };

  return response;
}
