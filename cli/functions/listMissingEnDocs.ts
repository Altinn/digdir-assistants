import { Client, Errors } from "typesense";
import * as typesenseSearch from "../lib/typesense-search";
import { config } from "../lib/config";

const cfg = config();

async function main() {
  const collectionName = process.env.TYPESENSE_DOCS_COLLECTION || "";

  if (!collectionName) {
    console.log(
      "Be sure to set the TYPESENSE_DOCS_COLLECTION environment variable to a valid collection name."
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
  let pageSize = 10;
  const jobPageSize = -1;
  const totalStart = Date.now();

  while (jobPageSize < 0 || page <= jobPageSize) {
    console.log(
      `Retrieving all Norwegian urls from collection '${collectionName}', page ${page} (page_size=${pageSize})`
    );

    // 1. Query 10 url_without_anchor, starts_with "https://docs.altinn.studio/nb/"

    const multiSearchArgs = {
      searches: [
        {
          collection: process.env.TYPESENSE_DOCS_COLLECTION,
          q: "https://docs.altinn.studio/nb/*",
          query_by: "url_without_anchor",
          include_fields: "language,url_without_anchor,token_count",
          sort_by: "token_count:desc",
          page: page,
          per_page: pageSize,
        },
      ],
    };

    // if (page == 5) {
    //   console.log(`multiSearchArgs: ${JSON.stringify(multiSearchArgs)}`)
    // }

    const searchResponse = await client.multiSearch.perform(multiSearchArgs);
    durations.queryDocs += Date.now() - totalStart;

    // if (page == 5) {
    //   console.log(`searchResponse: ${JSON.stringify(searchResponse)}`);
    // }

    // console.log(`all norwegian docs\n${JSON.stringify(searchResponse)}`);

    const norwegianDocs: any[] = searchResponse.results.flatMap((result: any) =>
      result.hits?.map((hit: any) => hit.document)
    );

    if (norwegianDocs.length === 0) {
      console.log(`Last page with results was page ${page - 1}`);
      break;
    }

    const multiSearches: any[] = searchResponse.results.flatMap((result: any) =>
      result.hits.map((hit: any) => {
        // console.log(`hit: ${JSON.stringify(hit)}`);
        const result = {
          collection: process.env.TYPESENSE_DOCS_COLLECTION,
          q: hit.document.url_without_anchor.replace(
            "https://docs.altinn.studio/nb/",
            "https://docs.altinn.studio/"
          ),
          query_by: "url_without_anchor",
          include_fields: "language,url_without_anchor,token_count",
          sort_by: "token_count:desc",
          page: 1,
          per_page: 4,
        };
        // console.log(`result: ${JSON.stringify(result)}`);
        return result;
      })
    );

    const enSearchResponse = await client.multiSearch.perform({
      searches: multiSearches,
    });

    const englishDocs: any[] = enSearchResponse.results.flatMap((result: any) =>
      result.hits.map((hit: any) => ({
        url_without_anchor: hit.document.url_without_anchor,
        language: hit.document.language,
        token_count: hit.document.token_count,
      }))
    );

    // 2. For each, query for same url, without /nb/
    //   - if missing, add to "missing" list
    //   - it not missing, but "language" == "no", add to "missing" and "mislabeled" list

    const missingDocs: any[] = [];
    const notActuallyEnglishDocs: any[] = [];

    // console.log(`englishDocs:\n${JSON.stringify(englishDocs)}`);
    console.log(`is_missing;is_mislabeled;token_count;actual_language;url_without_anchor`);

    norwegianDocs.forEach((norwegianDoc) => {
      const matchingEnglishDoc = englishDocs.find(
        (englishDoc) =>
          englishDoc.url_without_anchor ===
          norwegianDoc.url_without_anchor.replace(
            "https://docs.altinn.studio/nb/",
            "https://docs.altinn.studio/"
          )
      );

      if (matchingEnglishDoc) {
        if (matchingEnglishDoc.language != "en") {
          notActuallyEnglishDocs.push(matchingEnglishDoc);

          console.log(
            `true;true;${matchingEnglishDoc.token_count};${matchingEnglishDoc.url_without_anchor};`
          );
        }
      } else {
        missingDocs.push(norwegianDoc);
        console.log(
          `true;false;${norwegianDoc.token_count};unknown;${norwegianDoc.url_without_anchor};`
        );
      }
    });

    page++;
  }

  // TODO: get all documents in the English sitemap that have language != 'en'

  page = 1;
  pageSize = 100;

  while (jobPageSize < 0 || page <= jobPageSize) {
    // console.log(
    //   `Retrieving all urls from collection '${collectionName}', page ${page} (page_size=${pageSize})`
    // );

    // 1. Query 10 url_without_anchor, starts_with "https://docs.altinn.studio/nb/"

    const multiSearchArgs = {
      searches: [
        {
          collection: process.env.TYPESENSE_DOCS_COLLECTION,
          q: "*",
          query_by: "url_without_anchor",
          include_fields: "language,url_without_anchor,token_count",
          sort_by: "token_count:desc",
          page: page,
          per_page: pageSize,
        },
      ],
    };

    const searchResponse = await client.multiSearch.perform(multiSearchArgs);
    durations.queryDocs += Date.now() - totalStart;

    let englishDocs: any[] = searchResponse.results.flatMap((result: any) =>
      result.hits?.map((hit: any) => hit.document)
    );
    if (englishDocs.length === 0) {
      // console.log(`Last page with results was page ${page - 1}`);
      break;
    }
    englishDocs = englishDocs.filter(
      (hit) =>
        hit.url_without_anchor.startsWith("https://docs.altinn.studio/nb/") ==
          false && hit.language != "en"
    );

    englishDocs.forEach((englishDoc) => {
      console.log(
        `true;true;${englishDoc.token_count};${englishDoc.language};${englishDoc.url_without_anchor};`
      );
    });

    page++;
  }
}

main();
