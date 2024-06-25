import Typesense from "typesense";
import { DocumentSchema } from "typesense/lib/Typesense/Documents";
import { CollectionCreateSchema } from "typesense/lib/Typesense/Collections";
import { SearchResponseHit } from "typesense/lib/Typesense/Documents";
import { QueryRelaxation } from "./query-relaxation";
import { typesenseConfig } from "../config/typesense";
import { envVar } from "../general";
import { flatMap } from "remeda";
import { z } from "zod";

const typesenseCfg = typesenseConfig();

export interface RankedUrl {
  url: string;
  rank: number;
}

const RagDocSchema = z.object({
  id: z.string().optional(),
  content_markdown: z.string().optional(),
  url: z.string(),
  url_without_anchor: z.string(),
  type: z.string().optional(),
  language: z.string().optional(),
  item_priority: z.number(),
  updated_at: z.number(),
  markdown_checksum: z.string().optional(),
  token_count: z.number().optional(),
});
export type RagDoc = z.infer<typeof RagDocSchema>;

export type RagDocQuery = DocumentSchema & {
  id?: string;
  content_markdown?: string;
  url?: string;
  url_without_anchor?: string;
  type?: string;
  language?: string;
  item_priority?: number;
  updated_at?: number;
  markdown_checksum?: string;
  token_count?: number;
};

export async function lookupSearchPhrasesSimilar(
  phrasesCollectionName: string,
  relaxedQueries: QueryRelaxation,
  prompt: string,
): Promise<RankedUrl[]> {
  if (!relaxedQueries || !relaxedQueries.searchQueries) {
    console.warn(`typesenseSearchMultiple() - search terms not provided`);
    return [];
  }
  const client = new Typesense.Client(typesenseCfg);

  const multiSearchArgs = {
    searches: relaxedQueries.searchQueries.map((query) => ({
      collection: phrasesCollectionName,
      q: query,
      query_by: "search_phrase,phrase_vec",
      include_fields: "search_phrase,url",
      filter_by: `prompt:=${prompt}`,
      group_by: "url",
      group_limit: 1,
      limit: 20,
      sort_by: "_text_match:desc,_vector_distance:asc",
      prioritize_exact_match: false,
      drop_tokens_threshold: 5,
    })),
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});

  if (envVar("LOG_LEVEL") === "debug-relaxation") {
    console.log(
      `lookupSearchPhraseSimilar results:\n${JSON.stringify(response)}`,
    );
  }

  const searchPhraseHits = flatMap(response.results, (result: any) =>
    flatMap(result.grouped_hits, (group: any) => group.hits),
  );

  searchPhraseHits.sort(
    (a, b) =>
      b["hybrid_search_info"]["rank_fusion_score"] -
      a["hybrid_search_info"]["rank_fusion_score"],
  );

  const urlList: Array<RankedUrl> = searchPhraseHits.map((phrase) => ({
    url: phrase["document"]["url"],
    rank: phrase["hybrid_search_info"]["rank_fusion_score"],
  }));

  const uniqueUrls = urlList.filter(
    (value, index, self) =>
      index === self.findIndex((t) => t.url === value.url),
  );

  return uniqueUrls || [];
}

export async function retrieveAllUrls(
  docsCollectionName: string,
  page: number,
  pageSize: number,
) {
  const client = new Typesense.Client(typesenseCfg);

  const multiSearchArgs = {
    searches: [
      {
        collection: docsCollectionName,
        q: "*",
        query_by: "url_without_anchor",
        include_fields: "url_without_anchor,id",
        group_by: "url_without_anchor",
        group_limit: 1,
        sort_by: "item_priority:asc",
        page: page,
        per_page: pageSize,
      },
    ],
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  const searchPhraseHits = flatMap(response.results, (result: any) =>
    flatMap(result.grouped_hits, (group: any) =>
      flatMap(group.hits, (hit: any) => hit.document.url_without_anchor),
    ),
  );

  return searchPhraseHits;
}

export async function retrieveAllByUrl(
  docsCollectionName: string,
  urlList: RankedUrl[],
) {
  const client = new Typesense.Client(typesenseCfg);

  const urlSearches = urlList.slice(0, 20).map((rankedUrl) => ({
    collection: docsCollectionName,
    q: rankedUrl["url"],
    query_by: "url_without_anchor",
    include_fields: "id,url_without_anchor,type,content_markdown",
    filter_by: `url_without_anchor:=${rankedUrl["url"]}`,
    group_by: "url_without_anchor",
    group_limit: 1,
    page: 1,
    per_page: 1,
  }));

  const multiSearchArgs = { searches: urlSearches };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

const docsCollectionSchema = (
  collectionName: string,
): CollectionCreateSchema => {
  return {
    name: collectionName,
    symbols_to_index: ["_"],
    default_sorting_field: "item_priority",
    enable_nested_fields: false,
    fields: [
      { name: "id", type: "string", facet: true, index: true, optional: true },
      {
        name: "content_markdown",
        type: "string",
        facet: false,
        optional: true,
        index: true,
        sort: false,
        infix: false,
        locale: "en",
      },
      {
        name: "url",
        type: "string",
        facet: true,
        optional: false,
        index: true,
        sort: false,
        infix: false,
        locale: "",
      },
      {
        name: "url_without_anchor",
        type: "string",
        facet: true,
        optional: false,
        index: true,
        sort: false,
        infix: false,
        locale: "",
      },
      {
        name: "version",
        type: "string[]",
        facet: true,
        optional: true,
        index: true,
        sort: false,
        infix: false,
        locale: "",
      },
      {
        name: "type",
        type: "string",
        facet: true,
        optional: true,
        index: true,
        sort: false,
        infix: false,
        locale: "en",
      },
      {
        name: ".*_tag",
        type: "string",
        facet: true,
        optional: true,
        index: true,
        sort: false,
        infix: false,
        locale: "en",
      },
      {
        name: "language",
        type: "string",
        facet: true,
        optional: true,
        index: true,
        sort: false,
        infix: false,
        locale: "",
      },
      {
        name: "item_priority",
        type: "int64",
        facet: false,
        optional: false,
        index: true,
        sort: true,
        infix: false,
        locale: "",
      },
      {
        name: "updated_at",
        type: "int64",
        facet: true,
        optional: false,
        index: true,
        sort: true,
        infix: false,
        locale: "",
      },
      {
        name: "markdown_checksum",
        type: "string",
        facet: false,
        optional: true,
        index: false,
        sort: false,
        infix: false,
        locale: "",
      },
      {
        name: "token_count",
        type: "int64",
        facet: true,
        optional: true,
        index: true,
        sort: true,
        infix: false,
        locale: "",
      },
    ],
  };
};

export async function createDocsCollectionIfNotExists(collectionName: string) {
  const localTypesenseConfig = { ...typesenseCfg };
  localTypesenseConfig.apiKey = envVar("TYPESENSE_API_KEY_ADMIN");
  const client = new Typesense.Client(typesenseCfg);

  // if (envVar("LOG_LEVEL") === "debug") {
  //   console.log("Typesense config:\n", JSON.stringify(typesenseCfg, null, 2));
  // }

  const aliases = await client.aliases().retrieve();
  const alias = aliases.aliases.find(
    (alias: any) => alias?.name === collectionName,
  );
  if (alias) {
    if (envVar("LOG_LEVEL") === "debug") {
      console.log(
        `Alias ${collectionName} exists, points to ${alias.collection_name}.`,
      );
    }
    collectionName = alias.collection_name;
  } else {
    if (envVar("LOG_LEVEL") === "debug") {
      console.log(
        `Alias ${collectionName} not found, will look for a collection with this name.`,
      );
    }
  }

  const collections = await client.collections().retrieve();
  const collectionExists = collections.find(
    (collection: any) => collection?.name === collectionName,
  );

  if (!collectionExists) {
    console.log(`Collection ${collectionName} not found, will create.`);
    await client.collections().create(docsCollectionSchema(collectionName));
    console.log(`Collection ${collectionName} created successfully.`);
  } else {
    console.error(`Collection '${collectionName}' exists.`);
  }
}

export async function updateDocs(docs: RagDoc[], collectionName: string) {
  const typesenseCfg = typesenseConfig();
  typesenseCfg.apiKey = envVar("TYPESENSE_API_KEY_ADMIN");

  // console.log("Typesense config:\n", JSON.stringify(typesenseCfg, null, 2));

  const client = new Typesense.Client(typesenseCfg);

  // Index the document in Typesense
  const result = await client
    .collections<RagDocQuery>(collectionName)
    .documents()
    .import(docs, { action: "upsert" });

  const failedResults = result.filter((result: any) => !result.success);
  if (failedResults.length > 0) {
    console.log(
      `Upsert to typesense failed for the following urls:\n${failedResults}`,
    );
  }
}

export async function getDocChecksums(
  collectionName: string,
  idList: string[],
): Promise<RagDocQuery> {
  const client = new Typesense.Client(typesenseCfg);

  const documents = await client
    .collections<RagDocQuery>(collectionName)
    .documents()
    .search({
      q: "*",
      filter_by: idList.map((id) => `id:=${id}`).join(" || "),
      include_fields: "id,doc_id,markdown_checksum,url_without_anchor",
    });

  return documents.hits?.map((hit: any) => hit.document as RagDocQuery) || [];
}
