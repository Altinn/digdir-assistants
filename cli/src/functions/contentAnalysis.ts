import { Client, Errors } from 'typesense';

const { config } = require('../lib/config');
import * as typesenseSearch from '../lib/typesense-search';
import { openaiClient } from '@digdir/assistant-lib';
import { z } from 'zod';
import sha1 from 'sha1';
import { get_encoding } from 'tiktoken';

const cfg = config();

const openAI = openaiClient();


const encoding = get_encoding('cl100k_base');

const ContentAnalysisSchema = z.object({
  sourceLanguage: z.string().describe('ISO 639-1 language code for the user query'),
});

type ContentAnalysis = z.infer<typeof ContentAnalysisSchema>;

type SearchHit = any; // we want all fields coming from typesense

const systemPrompt = `Which language is used the most in the following content? Answer with the following JSON format:
{ "language": "en" } `;

const analyseContentPrompt = ``;

async function main() {
  const collectionName = process.env.TYPESENSE_DOCS_COLLECTION || '';

  if (!collectionName) {
    console.log(
      'Be sure to set the TYPESENSE_DOCS_COLLECTION environment variable to a valid collection name.',
    );
    process.exit(1);
  }

  const client = new Client(cfg.TYPESENSE_CONFIG);

  const durations = {
    total: 0,
    queryDocs: 0,
    countTokens: 0,
    analyze: 0,
  };

  let page = 1;
  const pageSize = 5;
  const jobPageSize = -1;
  const totalStart = Date.now();

  while (jobPageSize < 0 || page <= jobPageSize) {
    console.log(
      `Retrieving content_markdown for all urls from collection '${collectionName}', page ${page} (page_size=${pageSize})`,
    );

    const searchResponse = await typesenseSearch.retrieveAllChunks(
      collectionName,
      page,
      pageSize,
      '*',
    );
    durations.queryDocs += Date.now() - totalStart;

    const searchHits: SearchHit[] = searchResponse.results.flatMap((result: any) =>
      result.grouped_hits.flatMap((hit: any) => hit.hits.map((hit: any) => hit.document)),
    );

    let updatedDocs: SearchHit[] = [];

    console.log(`Retrieved ${searchHits.length} urls.`);

    if (searchHits.length === 0) {
      // console.log(`Last page with results was page ${page - 1}`);
      break;
    }

    let docIndex = 0;

    while (docIndex < searchHits.length) {
      const searchHit = searchHits[docIndex];
      const url = searchHit.url_without_anchor;
      // console.log(`searchHit: ${JSON.stringify(searchHit)}`);

      const contentMd = searchHit.content_markdown || '';
      const checksumMd = contentMd ? sha1(contentMd) : null;
      const checksumMatches = searchHit.markdown_checksum === checksumMd;

      if (checksumMatches && searchHit.language != null && searchHit.token_count != null) {
        console.log(`No checksum change detected, skipping url: ${url}`);
        docIndex++;
        continue;
      }

      let start = performance.now();
      console.log(`Analysing content, url: ${url}`);

      start = performance.now();

      const result = await analyzeContent(searchHit);
      updatedDocs.push(result);

      durations.analyze += performance.now() - start;
      durations.total += Math.round(performance.now() - totalStart);

      result.language = result.language == 'nb' || result.language == 'nn' ? 'no' : result.language;
      result.markdown_checksum = checksumMd;

      console.log(
        `Results -> doc id: ${result.id}, language: ${result.language}, token count: ${result.token_count}`,
      );
      if (result.language == 'no') {
        console.log(result.content_markdown.slice(0, 2000));
      }

      docIndex += 1;
      // end while
    }
    // store results on original document in typesense collection

    if (updatedDocs.length > 0) {
      console.log(`Upserting ${updatedDocs.length} docs...`);
      const results = await client
        .collections(collectionName)
        .documents()
        .import(updatedDocs, { action: 'upsert', return_id: true });
      const failedResults = results.filter((result: any) => !result.success);
      if (failedResults.length > 0) {
        console.log(`Upsert to typesense failed for the following urls:\n${failedResults}`);
      }
      updatedDocs = [];
    }

    page += 1;
  }
}

main();

async function analyzeContent(searchHit: SearchHit): Promise<SearchHit> {
  let retryCount = 0;

  while (true) {
    try {
      // console.log(`searchHit:\n${JSON.stringify(searchHit)}`);

      const content = searchHit.content_markdown.slice(0, 2000) || '';

      //  1. call OpenAI API to categorize content language
      let queryResult = await openAI.chat.completions.create({
        model: 'gemma-7b-it',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: analyseContentPrompt + content },
        ],
        // max_retries: 0,
      });
      let hitLanguage;

      if (queryResult && queryResult.choices && queryResult.choices.length > 0) {
        const content = queryResult?.choices[0]?.message?.content || '';
        hitLanguage = JSON.parse(content)?.language;
      }

      if (!hitLanguage) {
        console.error(
          `Failed to extract content language for url: ${searchHit.url_without_anchor}`,
        );
      }

      //  2. Use tiktoken wrapper to count tokens
      searchHit.token_count = encoding.encode(searchHit.content_markdown).length;

      return searchHit;
    } catch (e) {
      console.error(
        `Exception occurred while analysing content for url: ${
          searchHit.url_without_anchor || ''
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
}
