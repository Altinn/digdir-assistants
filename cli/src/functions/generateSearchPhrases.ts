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
  doc_num: string;
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
    .option('-n', 'create new target collection')
    .option('--partitions <number>', 'number of partitions to divide the work into')
    .option('--partition <number>', 'partition number for this process [0 < partition < partitions]')
    .option('--start <number>', 'page number to start from');

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

  // Convert opts.start to an integer
  const startPage = opts.start ? parseInt(opts.start, 10) : 1;
  if (isNaN(startPage)) {
    console.error('Invalid start page number. Please provide a valid integer.');
    process.exit(1);
  }
  let page = startPage;
  const pageSize = 20;
  const jobPageSize = -1;
  const partitionCount = opts.partitions || 1;
  const partitionIndex = Number(opts.partition) || 0;

  const totalStart = Date.now();

  while (jobPageSize < 0 || page <= jobPageSize) {
    console.log(
      `Retrieving chunk content '${opts.source}', page ${page} (page_size=${pageSize})`,
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
          doc_num: document.document.doc_num,
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

    let uniqueChunkIds = [...new Set(searchHits.map(hit => hit.id))];
    let uniqueDocNums = new Set(uniqueChunkIds.map(id => id.split('-')[0]));

    console.log(`Extracted ${uniqueDocNums.size} unique doc_num values from ${uniqueChunkIds.length} unique chunk IDs, from ${searchHits.length} search hits.`);

    // console.log(`Unique doc_nums: `, uniqueDocNums)
    // console.log('Unique chunk IDs:', uniqueChunkIds);

    if (partitionCount > 1) {
      uniqueDocNums = new Set(
        Array.from(uniqueDocNums).filter(docNum => 
          parseInt(docNum) % partitionCount === partitionIndex)
      );
    }
    uniqueChunkIds = uniqueChunkIds.filter(chunkId => {
      const docNum = chunkId.split('-')[0];
      return uniqueDocNums.has(docNum);
    });

    console.log(`After filtering, ${uniqueChunkIds.length} unique chunk IDs remain.`);
    console.log(`Unique doc_nums: `, uniqueDocNums)
    console.log('Unique chunk IDs:', uniqueChunkIds);

    
    if (uniqueChunkIds.length > 0) {
      const existingPhrases = await lookupSearchPhrasesForDocChunks(uniqueChunkIds, targetCollectionName, promptName);

      while (docIndex < searchHits.length) {
        const searchHit = searchHits[docIndex];
        const url = searchHit.url;

        // Check if the current searchHit.id is in the uniqueChunkIds list
        if (!uniqueChunkIds.includes(searchHit.id)) {
          console.log(`Skipping url: ${url} as it's not in the filtered chunk IDs`);
          docIndex++;
          continue;
        }

        const contentMd = searchHit.contentMarkdown;
        const checksumMd = contentMd ? sha1(contentMd) : null;

        const existingPhrasesForChunk = existingPhrases[searchHit.id];
        let existingPhraseCount = 0;

        if (existingPhrasesForChunk && existingPhrasesForChunk.hits) {
          existingPhraseCount = existingPhrasesForChunk.hits.length;
          // console.log(`Found existing phrases for chunk ID: ${searchHit.id}`);
        } else {
          // console.log(`No existing phrases found for chunk ID: ${searchHit.id}`);
        }
        if (existingPhraseCount > 0 && existingPhrasesForChunk?.hits) {
          const storedChecksum = existingPhrasesForChunk?.hits[0].document?.checksum || '';
          const checksumMatches = storedChecksum === checksumMd;

          // console.log(`Phrase list count: ${existingPhraseCount}, checksum: ${checksumMd} ${ (checksumMatches ? ' === ' : ' != ') } stored checksum: ${storedChecksum}, `)

          if (checksumMatches) {
            console.log(
              `Found ${existingPhraseCount} existing phrases and checksum matches, skipping for url: ${url}`,
            );
            docIndex++;
            continue;
          }
        }

        console.log(`Generating search phrases for chunk: ${url}`);

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

        if (existingPhraseCount > 0 && existingPhrasesForChunk?.hits) {
          // delete existing search phrases before uploading new
          for (const document of existingPhrasesForChunk?.hits) {
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
        }
        const uploadBatch: SearchPhraseEntry[] = [];

        let phraseCount = 0;
        for (const [index, phrase] of searchPhrases.entries()) {
          const entry: SearchPhraseEntry = {
            id: '' + searchHit.id + '-' + index,
            doc_num: '' + searchHit.id,
            chunk_id: '' + searchHit.id || '',
            chunk_index: index,
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
        console.log(`Generated ${uploadBatch.length} search phrases for chunk ${url}`);
        // Log each phrase
        uploadBatch.forEach((entry, index) => {
          console.log(`${entry.search_phrase}`);
        });
        console.log('\n');


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

async function lookupSearchPhrasesForDocChunks(
  chunk_ids: string[],
  collectionNameTmp: string,
  prompt: string,
): Promise<Record<string, SearchResponse<SearchPhraseEntry>>> {
  let retryCount = 0;

  while (true) {
    try {
      const lookupResults: MultiSearchResponse<SearchPhraseEntry[]> =
        await typesenseSearch.lookupSearchPhrasesForDocChunks(chunk_ids, collectionNameTmp, prompt);

      // Create a dictionary from each list in the lookupResults.results array
      const existingPhrasesByChunkId = chunk_ids.reduce((acc, chunkId, index) => {
        acc[chunkId] = lookupResults.results[index];
        return acc;
      }, {} as Record<string, SearchResponse<SearchPhraseEntry>>);
    
      // // Log the number of search phrases for each chunk_id
      // for (const chunkId of chunk_ids) {
      //   const phraseCount = existingPhrasesByChunkId[chunkId]?.hits?.length || 0;
      //   console.log(`Chunk ID ${chunkId}: ${phraseCount} search phrases`);
      // }
      
      return existingPhrasesByChunkId;
    } catch (e) {
      console.error(
        `Exception occurred while looking up search phrases for chunk_ids: ${chunk_ids}\n Error: ${e}`,
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
          model: 'gpt-4o-2024-08-06',
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
