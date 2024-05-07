import { SearchPhraseEntry } from "../lib/typesense-search";
import { SearchResponse } from "typesense/lib/Typesense/Documents";
import { MultiSearchResponse } from "typesense/lib/Typesense/MultiSearch";
import Instructor from "@instructor-ai/instructor";
import { Command } from "commander";

import {Client, Errors} from 'typesense'
import { config } from "../lib/config";
import * as typesenseSearch from "../lib/typesense-search";
import OpenAI from "openai"
import { z } from "zod"
import sha1 from "sha1";

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

type SearchPhraseList = z.infer<typeof SearchPhraseListSchema>;

type SearchHit = {
  id: string;
  url: string;
  contentMarkdown: string;
}

const generatePrompt = `Please analyze the contents of the following documentation article and generate a list of English phrases that you would expect to match the following document. 
DO NOT include the phrases "Altinn Studio", "Altinn 3" or "Altinn apps".

Document:

`;

async function main() {

  const program = new Command();
  program.name('generate-search-phrases')
    .description('Use LLMs to generate search phrases for markdown content')
    .version('0.1.0');


  program
    .option('--prompt <string>, ', 'prompt name', 'original')
    .option('-c, --collection <string>', 'collection to update (or -n for new)')
    .option('-n', 'create new collection based on TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION env var')
    ;

  program.parse(process.argv);
  const opts = program.opts();
  
  let promptName = opts.prompt;
  let collectionNameTmp = opts.collection;

  const client = new Client(cfg.TYPESENSE_CONFIG);

  if (opts.n) {
    collectionNameTmp = `${
      process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION
    }_${Date.now()}`;
  
    await typesenseSearch.setupSearchPhraseSchema(collectionNameTmp);
  } else {
    console.log(`Will update existing search phrases in collection: '${process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION}'`);
  }

  const durations = {
    total: 0,
    countTokens: 0,
    queryDocs: 0,
    generatePhrases: 0,
    storePhrases: 0,
  };

  let page = 1;
  const pageSize = 10;
  const jobPageSize = -1;

  const totalStart = Date.now();


  while (jobPageSize < 0 || page <= jobPageSize) {
    console.log(
      `Retrieving content_markdown for all urls from collection '${process.env.TYPESENSE_DOCS_COLLECTION}', page ${page} (page_size=${pageSize})`
    );

    const searchResponse = await typesenseSearch.typesenseRetrieveAllUrls(
      page,
      pageSize
    );
    durations.queryDocs += Date.now() - totalStart;

    const searchHits: SearchHit[] = searchResponse.results.flatMap((result: any) =>
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

      // console.log(`searchHit: ${JSON.stringify(searchHit)}`);

      const existingPhrases = await lookupSearchPhrases(url, collectionNameTmp);

      // console.log(`existing phrases:\n${JSON.stringify(existingPhrases)}`);

      const contentMd = searchHit.contentMarkdown;
      const checksumMd = contentMd ? sha1(contentMd) : null;

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

      const result = await generateSearchPhrases(promptName, searchHit);
      
      durations.generatePhrases += performance.now() - start;
      durations.total += Math.round(performance.now() - totalStart);
      

      let searchPhrases: string[] = [];
      if (result !== null) {
        searchPhrases = result.searchPhrases.map((context: any) => context.searchPhrase);
      } else {
        searchPhrases = [];
      }

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
            if (error instanceof Errors.ObjectNotFound) {
              console.log(
                `Search phrase ID ${docId} not found in collection "${collectionNameTmp}"`
              );
            }
          }
        }
      }
      console.log(`Search phrases:`);

      const uploadBatch: SearchPhraseEntry[] = [];

      for (const [index, phrase] of searchPhrases.entries()) {
        console.log(phrase);
        const batch: SearchPhraseEntry = {
          doc_id: searchHit.id || "",
          url: url,
          search_phrase: phrase,
          sort_order: index,
          item_priority: 1,
          updated_at: Math.floor(new Date().getTime() / 1000),
          checksum: checksumMd,
          prompt: "original"
        };
        if (batch.search_phrase) {
          uploadBatch.push(batch);
        }
      }

      const results = await client.collections(collectionNameTmp).documents()
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

async function generateSearchPhrases(prompt: string, searchHit: SearchHit): Promise<SearchPhraseList> {
  let retryCount = 0;

  if (prompt != "original") {
    throw new Error(`unknown prompt name \'${prompt}\'`);
  }

  while (true) {
    try {
      const content = searchHit.contentMarkdown || "";

      let queryResult = await openaiClientInstance.chat.completions.create({
        model: 'gpt-4-turbo-preview',        
        response_model: {
          schema: SearchPhraseListSchema,
          name: "RagPromptReplySchema",
        },
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: generatePrompt + content },
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
