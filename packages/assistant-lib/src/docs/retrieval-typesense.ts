import Typesense from "typesense";
import { DocumentSchema } from "typesense/lib/Typesense/Documents";
import { CollectionCreateSchema } from "typesense/lib/Typesense/Collections";
export { ImportResponse } from "typesense/lib/Typesense/Documents";
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
  uuid: z.string(),
  doc_num: z.string(),
  title: z.string().optional(),
  url: z.string(),
  url_without_anchor: z.string(),
  source_document_url: z.string(),
  type: z.string().optional(),
  language: z.string().optional(),
  item_priority: z.number(),
  updated_at: z.number(),
  source_updated_at: z.string().optional(),
  markdown_checksum: z.string().optional(),
});
export type RagDoc = z.infer<typeof RagDocSchema>;

export type RagDocQuery = DocumentSchema & {
  id?: string;
  doc_num?: string;
  content_markdown?: string;
  url?: string;
  url_without_anchor?: string;
  type?: string;
  language?: string;
  item_priority?: number;
  updated_at?: number;
  source_updated_at?: string;
  markdown_checksum?: string;
  token_count?: number;
};

const RagChunkSchema = z.object({
  id: z.string().optional(),
  chunk_id: z.string(),
  doc_num: z.string(),
  chunk_index: z.number(),
  url: z.string(),
  url_without_anchor: z.string(),
  content_markdown: z.string().optional(),
  markdown_checksum: z.string().optional(),
  type: z.string().optional(),
  token_count: z.number().optional(),
  language: z.string().optional(),
  item_priority: z.number(),
  updated_at: z.number(),
});
export type RagChunk = z.infer<typeof RagChunkSchema>;

export type RagChunkQuery = DocumentSchema & {
  id?: string;
  chunk_id?: string;
  doc_num?: string;
  chunk_index?: number;
  url?: string;
  url_without_anchor?: string;
  content_markdown?: string;
  markdown_checksum?: string;
  token_count?: number;
  language?: string;
  type?: string;
  item_priority?: number;
  updated_at?: number;
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
      filter_by: `prompt:=\`${prompt}\``,
      group_by: "url",
      group_limit: 1,
      limit: 20,
      sort_by: "_text_match:desc,_vector_distance:asc",
      prioritize_exact_match: false,
      drop_tokens_threshold: 5,
    })),
  };

  if (true || envVar("LOG_LEVEL") === "debug-relaxation") {
    console.log(
      `lookupSearchPhraseSimilar query args:\n${JSON.stringify(multiSearchArgs)}`,
    );
  }

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
        // sort_by: "item_priority:asc",
        page: page,
        per_page: pageSize,
      },
    ],
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});

  if (envVar("LOG_LEVEL") === "debug") {
    console.log(`retrieveAllUrls response:\n${JSON.stringify(response)}`);
  }

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
    include_fields: "id,doc_num,url_without_anchor,type,content_markdown",
    filter_by: `url_without_anchor:=\`${rankedUrl["url"]}\``,
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
    default_sorting_field: "",
    enable_nested_fields: false,
    fields: [
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "doc_num",
        optional: false,
        sort: true,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "url_without_anchor",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "updated_at",
        optional: false,
        sort: true,
        stem: false,
        store: true,
        type: "int64",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "uuid",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "type",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "title",
        optional: true,
        sort: true,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "subtitle",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "isbn",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "abstract",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "language",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "source_document_type",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "source_document_url",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "source_page_url",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "source_published_at",
        optional: true,
        sort: true,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "source_created_at",
        optional: true,
        sort: true,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "source_updated_at",
        optional: true,
        sort: true,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "markdown_checksum",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
    ],
  };
};

const chunksCollectionSchema = (
  collectionName: string,
  docsCollectionName: string,
): CollectionCreateSchema => {
  return {
    name: collectionName,
    symbols_to_index: ["_"],
    default_sorting_field: "",
    enable_nested_fields: false,
    fields: [
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "chunk_id",
        optional: false,
        sort: true,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "doc_num",
        optional: false,
        reference: docsCollectionName + ".doc_num",
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "chunk_index",
        optional: false,
        sort: true,
        stem: false,
        store: true,
        type: "int32",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "no",
        name: "content_markdown",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "url",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "url_without_anchor",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "en",
        name: "type",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "item_priority",
        optional: false,
        sort: true,
        stem: false,
        store: true,
        type: "int64",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "updated_at",
        optional: false,
        sort: true,
        stem: false,
        store: true,
        type: "int64",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "language",
        optional: false,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: false,
        index: true,
        infix: false,
        locale: "",
        name: "markdown_checksum",
        optional: true,
        sort: false,
        stem: false,
        store: true,
        type: "string",
      },
      {
        facet: true,
        index: true,
        infix: false,
        locale: "",
        name: "token_count",
        optional: true,
        sort: true,
        stem: false,
        store: true,
        type: "int64",
      },
    ],
  };
};

export async function ensureDocsAndChunksCollections(
  docsCollectionName: string,
) {
  ensureCollectionExists(
    docsCollectionName,
    docsCollectionSchema(docsCollectionName),
  );
  ensureCollectionExists(
    docsCollectionName,
    chunksCollectionSchema(
      docsCollectionName.replace("docs", "chunks"),
      docsCollectionName,
    ),
  );
}

export async function ensureCollectionExists(
  collectionName: string,
  schema: CollectionCreateSchema,
) {
  const localTypesenseConfig = { ...typesenseCfg };
  localTypesenseConfig.apiKey = envVar("TYPESENSE_API_KEY_ADMIN");
  const client = new Typesense.Client(localTypesenseConfig);

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
    await client.collections().create(schema);
    console.log(`Collection ${collectionName} created successfully.`);
  } else {
    console.error(`Collection '${collectionName}' exists.`);
  }
}

export async function updateDocs(docs: RagDoc[], collectionName: string) {

  const typesenseCfg = typesenseConfig();
  const localTypesenseConfig = { ...typesenseCfg };
  localTypesenseConfig.apiKey = envVar("TYPESENSE_API_KEY_ADMIN");
  const client = new Typesense.Client(localTypesenseConfig);

  // Index the document in Typesense
  const results = await client
    .collections<RagDocQuery>(collectionName)
    .documents()
    .import(docs, { action: "upsert" });

  return results;
}

export async function updateChunks(chunks: RagChunk[], collectionName: string) {
  const typesenseCfg = typesenseConfig();
  const localTypesenseConfig = { ...typesenseCfg };
  localTypesenseConfig.apiKey = envVar("TYPESENSE_API_KEY_ADMIN");
  const client = new Typesense.Client(localTypesenseConfig);

  // Index the document in Typesense
  const results = await client
    .collections<RagChunkQuery>(collectionName)
    .documents()
    .import(chunks, { action: "upsert" });

  return results;
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
      include_fields: "id,markdown_checksum,url_without_anchor",
    });

  return documents.hits?.map((hit: any) => hit.document as RagDocQuery) || [];
}

export async function getDocsById(collectionName: string, idList: string[]) {
  const client = new Typesense.Client(typesenseCfg);

  const documents = await client
    .collections<RagDocQuery>(collectionName)
    .documents()
    .search({
      q: "*",
      filter_by: idList.map((id) => `id:=${id}`).join(" || "),
      include_fields: "id,title,url_without_anchor",
    });

  return documents.hits?.map((hit: any) => hit.document as RagDocQuery) || [];
}
