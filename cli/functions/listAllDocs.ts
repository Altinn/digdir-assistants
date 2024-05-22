import { Client, Errors } from "typesense";
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
  let pageSize = 100;
  const jobPageSize = -1;
  const totalStart = Date.now();

  console.log(
    `Retrieving all docs from collection '${collectionName}', page ${page} (page_size=${pageSize})\n\n`
  );

  console.log(`token_count;actual_language;url_without_anchor`);



  while (jobPageSize < 0 || page <= jobPageSize) {

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


    const allDocs: any[] = searchResponse.results.flatMap((result: any) =>
      result.hits?.map((hit: any) => hit.document)
    );

    if (allDocs.length === 0) {
      console.log(`Last page with results was page ${page - 1}`);
      break;
    }

    allDocs.forEach((doc) => {
      console.log(`${doc.token_count};${doc.language};${doc.url_without_anchor};`);      
    });

    page++;
  }
}

main();
