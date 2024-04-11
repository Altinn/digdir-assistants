import { SearchPhraseEntry } from "../lib/typesense-search";
import { SearchResponse } from "typesense/lib/Typesense/Documents";
import { MultiSearchResponse } from "typesense/lib/Typesense/MultiSearch";

// Assuming use of CommonJS modules
const Typesense = require("typesense");
const { config } = require("../lib/config.ts");
const typesenseSearch = require("../lib/typesense-search.ts");
const OpenAI = require("openai");
const Instructor = require("@instructor-ai/instructor");
const z = require("zod");
// const dotenv = require("dotenv");
const sha1 = require("sha1");

// dotenv.config();

const cfg = config();

const openAI = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const openaiClientInstance = Instructor({
  client: openAI,
  mode: "FUNCTIONS",
  debug: process.env.DEBUG_INSTRUCTOR == "true",
});

const SearchPhraseSchema = z.object({
  searchPhrase: z.string(),
});

const SearchPhraseListSchema = z.object({
  searchPhrases: z.array(SearchPhraseSchema),
});

const generatePrompt = `Please analyze the contents of the following documentation article and generate a list of English phrases that you would expect to match the following document. 
DO NOT include the phrases "Altinn Studio", "Altinn 3" or "Altinn apps".

Document:

`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: node index.js <collectionNameTmp>");
    process.exit(1);
  }

  let collectionNameTmp = args[0];

  const client = new Typesense.TypesenseClient(cfg.TYPESENSE_CONFIG);

  // TODO: create a new Typesense collection

  // if (!collectionNameTmp || collectionNameTmp.length === 0) {
  //   collectionNameTmp = `${
  //     process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION
  //   }_${Date.now()}`;
  //
  //   await typesenseSearch.setupSearchPhraseSchema(collectionNameTmp);
  // }

  const durations = {
    total: 0,
    queryDocs: 0,
    generatePhrases: 0,
    storePhrases: 0,
  };

  let page = 1;
  const pageSize = 10;
  const jobPageSize = 2;

  const totalStart = Date.now();

  while (page <= jobPageSize) {
    console.log(
      `Retrieving content_markdown for all urls, page ${page} (page_size=${pageSize})`
    );

    const searchResponse = await typesenseSearch.typesenseRetrieveAllUrls(
      page,
      pageSize
    );
    durations.queryDocs += Date.now() - totalStart;

    const searchHits = searchResponse.results.flatMap((result: any) =>
      result.grouped_hits.flatMap((hit: any) =>
        hit.hits.map((document: any) => ({
          id: document.document.id,
          url: document.document.url_without_anchor,
          contentMarkdown: document.document.content_markdown || "",
        }))
      )
    );

    console.log(`Retrieved ${searchHits.length} urls.`);

    if (searchHits.length === 0) {
      console.log(`Last page with results was page ${page - 1}`);
      break;
    }

    let docIndex = 0;

    while (docIndex < searchHits.length) {
      const searchHit = searchHits[docIndex];
      const url = searchHit.url;

      const existingPhrases = await lookupSearchPhrases(url, collectionNameTmp);

      const contentMd = searchHit.contentMarkdown;
      const checksumMd = contentMd ? sha1(contentMd) : null; // Ensure you have a function or library to compute SHA1

      const existingPhraseCount = existingPhrases.found || 0;

      if (existingPhraseCount > 0) {
        const storedChecksum = existingPhrases.hits?.[0]?.document?.checksum || "";
        const checksumMatches = storedChecksum === checksumMd;

        if (checksumMatches) {
          console.log(
            `Found existing phrases and checksum matches, skipping for url: ${url}`
          );
          docIndex++;
          continue;
        }
      }

      console.log(`Generating search phrases for url: ${url}`);

      const start = performance.now();

      const result = await generateSearchPhrases(searchHit);

      durations.generatePhrases += performance.now() - start;
      durations.total += Math.round(performance.now() - totalStart);

      let search_phrases = [];
      if (result.function !== null) {
        search_phrases = result.function.search_phrases.map((context: any) => ({
          search_phrase: context.search_phrase,
        }));
      } else {
        search_phrases = [];
      }

      console.log(`Generated search phrases for: ${url}\n`);

      // delete existing search phrases before uploading new
      for (const document of existingPhrases.hits || []) {
        const docId = document.document?.doc_id || "";
        if (docId) {
          try {
            await client
              .collections(collectionNameTmp)
              .documents(docId)
              .delete();
            console.log(`Search phrase ID ${docId} deleted for url: ${url}`);
          } catch (error) {
            if (error instanceof Typesense.exceptions.ObjectNotFound) {
              console.log(
                `Search phrase ID ${docId} not found in collection "${collectionNameTmp}"`
              );
            }
          }
        }
      }

      const uploadBatch: SearchPhraseEntry[] = [];

      for (const [index, phrase] of search_phrases.entries()) {
        console.log(phrase);
        const batch: SearchPhraseEntry = {
          doc_id: searchHit.id || "",
          url: url,
          search_phrase: phrase.search_phrase || "",
          sort_order: index,
          item_priority: 1,
          updated_at: Math.floor(new Date().getTime() / 1000),
          checksum: checksumMd,
        };
        uploadBatch.push(batch);
      }

      const results = await client.collections(collectionNameTmp)
                                  .documents
                                  .import(uploadBatch, { action: "upsert", return_id: true });
      const failedResults = results.filter((result: any) => !result.success);
      if (failedResults.length > 0) {
        console.log(
          `The following search_phrases for url:\n  "${url}"\n were not successfully upserted to typesense:\n${failedResults}`
        );
      }

      docIndex += 1;
      // end while
    }
    page += 1;
  }
}

main();

async function lookupSearchPhrases(
  url: string,
  collectionNameTmp: string
): Promise<SearchResponse<SearchPhraseEntry>> {
  let retryCount = 0;

  while (true) {
    try {
      const lookupResults: MultiSearchResponse<SearchPhraseEntry[]> = await typesenseSearch.lookupSearchPhrases(
        url,
        collectionNameTmp
      );
      const existingPhrases = lookupResults.results[0];
      return existingPhrases;
    } catch (e) {
      console.error(
        `Exception occurred while looking up search phrases for url: ${url}\n Error: ${e}`
      );
      if (retryCount < 10) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw e;
      }
    }
  }
}

async function generateSearchPhrases(searchHit: any): Promise<any> {
  let retryCount = 0;

  while (true) {
    try {
      const content = searchHit.content_markdown || "";

      let queryResult = await openaiClientInstance.chat.completions.create({
        model: process.env.OPENAI_API_MODEL_NAME,
        response_model: {
          schema: SearchPhraseListSchema,
          name: "RagPromptReplySchema",
        },
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "human", content: prompt + content },
        ],
        max_retries: 0,
      });
      
      return queryResult;
      
    } catch (e) {
      console.error(
        `Exception occurred while generating search phrases for url: ${
          searchHit.url || ""
        }\n Error: ${e}`
      );
      if (retryCount < 10) {
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw e;
      }
    }
  }
}
