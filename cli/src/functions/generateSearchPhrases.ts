import Groq from 'groq-sdk';

import { SearchPhraseEntry } from '../lib/typesense-search';
import { SearchResponse } from 'typesense/lib/Typesense/Documents';
import { MultiSearchResponse } from 'typesense/lib/Typesense/MultiSearch';
import Instructor from '@instructor-ai/instructor';
import { Command } from 'commander';

import { Client, Errors } from 'typesense';
import { config } from '../lib/config';
import * as typesenseSearch from '../lib/typesense-search';
import { openaiClient, extractCodeBlockContents } from '@digdir/assistant-lib';

import { z } from 'zod';
import sha1 from 'sha1';

const cfg = config();

const openAI = openaiClient();

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const openaiClientInstance = Instructor({
  client: openAI as any,
  mode: 'FUNCTIONS',
  debug: process.env.DEBUG_INSTRUCTOR == 'true',
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
};

const originalPrompt = `Please analyze the contents of the following documentation article and generate a list of English phrases that you would expect to match the following document. 

Document:

`;

const keywordSearchPromptNew = `Please analyze the contents of the following documentation article and generate a list of keyword search phrases that you would expect to match the following document. 

Document:

`;

// for use as system prompt in JSON mode with llama3-8b on Groq
const typicalQsSysPrompt = `Generate a list of typical questions that a user might have, that can be answered by the following documentation article. Return only the list of questions as a JSON string array in a code block, do not include answers.`;

async function main() {
  const program = new Command();
  program
    .name('generate-search-phrases')
    .description('Use LLMs to generate search phrases for markdown content')
    .version('0.1.0');

  program
    .requiredOption('-s, --source <string>', 'collection to extract from')
    .requiredOption('-t, --target <string>', 'target collection name')
    .option('--prompt <string>, ', 'prompt name', 'original')
    .option('-n', 'create new target collection');

  program.parse(process.argv);
  const opts = program.opts();

  let promptName = opts.prompt;
  let targetCollectionName = opts.collection;

  const promptNames = ['original', 'typicalqs', 'keyword-search'];
  if (!promptNames.includes(promptName)) {
    console.error(`Invalid prompt name. Prompt name must be one of: ${promptNames}`);
    process.exit(1);
  }

  const client = new Client(cfg.TYPESENSE_CONFIG);
  targetCollectionName = opts.target;
  const collectionFound = await typesenseSearch.lookupCollectionByNameExact(targetCollectionName);

  if (opts.n) {
    if (collectionFound) {
      console.error(`Collection '${targetCollectionName}' already exists, aborting.`);
      return;
    }
    await typesenseSearch.setupSearchPhraseSchema(targetCollectionName);
    console.log(`Collection '${targetCollectionName}' created.`);
  } else {
    if (!collectionFound) {
      console.error(
        `Collection '${targetCollectionName}' not found. To create, use the '-n' option.`,
      );
      return;
    }

    if (collectionFound.name != targetCollectionName) {
      `Resolved alias '${targetCollectionName}' to collection '${collectionFound.name}'`;
    }
    targetCollectionName = collectionFound.name;

    console.log(`Will update existing search phrases in collection: '${targetCollectionName}'`);
  }

  const durations = {
    total: 0,
    countTokens: 0,
    queryDocs: 0,
    generatePhrases: 0,
    storePhrases: 0,
  };

  let page = 1;
  const pageSize = 30;
  const jobPageSize = -1;

  const totalStart = Date.now();

  while (jobPageSize < 0 || page <= jobPageSize) {
    console.log(
      `Retrieving content_markdown for all urls from collection '${opts.source}', page ${page} (page_size=${pageSize})`,
    );

    const searchResponse = await typesenseSearch.typesenseRetrieveAllUrls(
      opts.source,
      page,
      pageSize,
    );
    durations.queryDocs += Date.now() - totalStart;

    const searchHits: SearchHit[] = searchResponse.results.flatMap((result: any) =>
      result.grouped_hits.flatMap((hit: any) =>
        hit.hits.map((document: any) => ({
          id: document.document.id,
          url: document.document.url_without_anchor,
          contentMarkdown: document.document.content_markdown || '',
        })),
      ),
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

      const existingPhrases = await lookupSearchPhrases(url, targetCollectionName, promptName);

      // console.log(`existing phrases:\n${JSON.stringify(existingPhrases)}`);

      const contentMd = searchHit.contentMarkdown;
      const checksumMd = contentMd ? sha1(contentMd) : null;

      const existingPhraseCount = existingPhrases.found || 0;

      if (existingPhraseCount > 0) {
        const storedChecksum = existingPhrases.hits?.[0]?.document?.checksum || '';
        const checksumMatches = storedChecksum === checksumMd;

        if (checksumMatches) {
          console.log(
            `Found ${existingPhraseCount} existing phrases and checksum matches, skipping for url: ${url}`,
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
      if (searchPhrases.length == 0) {
        docIndex++;
        continue;
      }

      // delete existing search phrases before uploading new
      for (const document of existingPhrases.hits || []) {
        const phraseId = document.document?.id || '';
        if (phraseId) {
          try {
            await client.collections(targetCollectionName).documents(phraseId).delete();
            console.log(`Search phrase ID ${phraseId} deleted for url: ${url}`);
          } catch (error) {
            if (error instanceof Errors.ObjectNotFound) {
              console.log(
                `Search phrase ID ${phraseId} not found in collection "${targetCollectionName}"`,
              );
            } else {
              console.error(`Error occurred while removing existing search phrases: ${error}`);
            }
          }
        }
      }
      console.log(`Search phrases:`);

      const uploadBatch: SearchPhraseEntry[] = [];

      for (const [index, phrase] of searchPhrases.entries()) {
        console.log(phrase);
        const entry: SearchPhraseEntry = {
          doc_id: searchHit.id || '',
          url: url,
          search_phrase: phrase,
          sort_order: index,
          item_priority: 1,
          updated_at: Math.floor(new Date().getTime() / 1000),
          checksum: checksumMd,
          prompt: promptName,
        };
        if (entry.search_phrase) {
          uploadBatch.push(entry);
        } else {
          console.error(`Empty search phrase generated in entry: ${JSON.stringify(entry)}`);
        }
      }

      try {
        const results = await client
          .collections(targetCollectionName)
          .documents()
          .import(uploadBatch, { action: 'upsert', return_id: true });
        const failedResults = results.filter((result: any) => !result.success);
        if (failedResults.length > 0) {
          console.log(
            `The following search_phrases for url:\n  "${url}"\n were not successfully upserted to typesense:\n${failedResults}`,
          );
        }
      } catch (error) {
        console.error(
          `An error occurred while importing documents to '${targetCollectionName}'\nERROR: ${error}`,
        );

        console.log(`Failed batch content:\n${JSON.stringify(uploadBatch)}`);
        return;
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
  collectionNameTmp: string,
  prompt: string,
): Promise<SearchResponse<SearchPhraseEntry>> {
  let retryCount = 0;

  while (true) {
    try {
      const lookupResults: MultiSearchResponse<SearchPhraseEntry[]> =
        await typesenseSearch.lookupSearchPhrases(url, collectionNameTmp, prompt);
      const existingPhrases = lookupResults.results[0];
      return existingPhrases;
    } catch (e) {
      console.error(
        `Exception occurred while looking up search phrases for url: ${url}\n Error: ${e}`,
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

async function generateSearchPhrases(
  prompt: string,
  searchHit: SearchHit,
): Promise<SearchPhraseList> {
  let retryCount = 0;

  if (prompt == 'original' || prompt == 'keyword-search') {
    const basePrompt = prompt == 'original' ? originalPrompt : keywordSearchPromptNew;
    while (true) {
      try {
        const content = searchHit.contentMarkdown || '';

        let queryResult = await openaiClientInstance.chat.completions.create({
          model: 'gpt-4o',
          response_model: {
            schema: SearchPhraseListSchema,
            name: 'SearchPhraseListSchema',
          },
          temperature: 0.1,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: basePrompt + content },
          ],
          max_retries: 0,
        });

        return queryResult;
      } catch (e) {
        console.error(
          `Exception occurred while generating search phrases for url: ${
            searchHit.url || ''
          }\n Error: ${e}`,
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
  } else if (prompt == 'typicalqs') {
    while (true) {
      try {
        let queryResult = await groqClient.chat.completions.create({
          model: 'llama3-8b-8192',
          //response_format: { type: "json_object" },
          temperature: 0.6,
          messages: [
            { role: 'system', content: typicalQsSysPrompt },
            { role: 'user', content: searchHit.contentMarkdown.slice(0, 7000) },
          ],
        });
        if (queryResult && queryResult.choices && queryResult.choices.length > 0) {
          // use

          const response = queryResult?.choices[0]?.message?.content || '';
          console.log(`Groq response:\n${response}`);

          const jsonExtracted = extractCodeBlockContents(response);
          console.log(`JSON extracted:\n${jsonExtracted}`);

          const typicalQsList = JSON.parse(jsonExtracted);

          const extractedValues = typicalQsList.flatMap((item) => {
            if (typeof item === 'object') {
              return Object.values(item);
            }
            return item;
          });
          console.log(`parsed json:\n${JSON.stringify(extractedValues)}`);

          const mapped = extractedValues
            .filter((item) => typeof item === 'string')
            .map((item) => ({ searchPhrase: item }));

          return { searchPhrases: mapped };
        } else {
          throw new Error('invalid response from groq');
        }
      } catch (e) {
        console.error(
          `Exception occurred while generating search phrases for url: ${
            searchHit.url || ''
          }\n Error: ${e}`,
        );
        if (retryCount < 10) {
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        } else {
          return { searchPhrases: [] };
        }
      }
    }
  } else throw new Error(`unknown prompt name \'${prompt}\'`);
}
