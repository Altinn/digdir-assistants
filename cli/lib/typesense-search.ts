import typesense from "typesense";
import { config } from "./config";
import { z } from "zod";
import { CollectionCreateSchema } from "typesense/lib/Typesense/Collections.js";
import { MultiSearchResponse } from "typesense/lib/Typesense/MultiSearch.js";

const cfg = config();

export interface SearchPhraseDoc {
  url: string;
  rank: number;
}

export interface SearchPhraseEntry {
  doc_id: string;
  url: string;
  search_phrase: string;
  sort_order: number;
  item_priority?: number;
  updated_at: number;
  checksum: string;
  prompt?: string;
};

type HybridSearchInfo = {
  rank_fusion_score: number;
}


const SearchPhrasesSchema = z.object({
  searchQueries: z.array(z.string()),
});
type SearchPhrases = z.infer<typeof SearchPhrasesSchema>;

interface VectorQuery {
  // Define the structure for vector queries if needed
}

export async function typesenseSearchMultiple(
  searchQueries: SearchPhrases,
): Promise<any> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);

  console.log(`incoming queries: ${searchQueries}`);

  const multiSearchArgs = {
    "searches": searchQueries.searchQueries.map((query) => ({
      "collection": process.env.TYPESENSE_DOCS_COLLECTION,
      "q": query,
      "query_by": "content,embedding",
      "include_fields":
        "id,url_without_anchor,type,content_markdown",
      "group_by": "url_without_anchor",
      "group_limit": 3,
      "limit": 10,
      "prioritize_exact_match": false,
      "sort_by": "_text_match:desc",
      "drop_tokens_threshold": 5,
    })),
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

export async function lookupSearchPhrasesSimilar(
  searchQueries: SearchPhrases,
): Promise<SearchPhraseDoc[]> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);

  const multiSearchArgs = {
    "searches": searchQueries.searchQueries.map((query) => ({
      "collection": process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION,
      "q": query,
      "query_by": "search_phrase,phrase_vec",
      "include_fields": "search_phrase,url",
      "group_by": "url",
      "group_limit": 1,
      "limit": 20,
      "sort_by": "_text_match:desc,_vector_distance:asc",
      "prioritize_exact_match": false,
      "drop_tokens_threshold": 5,
    })),
  };

  const response = await client.multiSearch.perform<SearchPhraseDoc[]>(
    multiSearchArgs,
    {},
  );

  const searchPhraseHits = response.results.flatMap((result) =>
    result.grouped_hits?.flatMap((hit) => hit.hits)
  )
  .sort((a: any, b: any) =>
    b?.hybrid_search_info.rank_fusion_score -
    a?.hybrid_search_info.rank_fusion_score 
  );

  const urlList: SearchPhraseDoc[] = searchPhraseHits.map((phrase) => ({
    url: phrase?.document.url || '',
    rank: (phrase as any).hybrid_search_info?.rank_fusion_score,
  }));

  const uniqueUrls: SearchPhraseDoc[] = [];
  urlList.forEach((url) => {
    if (!uniqueUrls.some((u) => u.url === url.url)) {
      uniqueUrls.push(url);
    }
  });

  return uniqueUrls;
}

export async function typesenseSearchMultipleVector(
  searchQueries: SearchPhrases,
): Promise<any> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);

  // Vector conversion logic would be here
  let vectorQueries: VectorQuery[] = []; // Placeholder for vector queries

  const multiSearchArgs = {
    "searches": vectorQueries.map((query) => ({
      "collection": process.env.TYPESENSE_DOCS_COLLECTION,
      "q": "*",
      "vector_query": `embedding:([${query}], k:10)`,
      "include_fields":
        "id,url_without_anchor,type,content_markdown",
    })),
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

export async function typesenseRetrieveAllUrls(
  page: number,
  pageSize: number,
  includeFields: string = "url_without_anchor,content_markdown,id"
): Promise<any> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);

  const multiSearchArgs = {
    "searches": [{
      "collection": process.env.TYPESENSE_DOCS_COLLECTION,
      "q": "*",
      "query_by": "url_without_anchor",
      "include_fields": includeFields,
      "filter_by": "type:=content",
      "group_by": "url_without_anchor",
      "group_limit": 1,
      "sort_by": "item_priority:asc",
      "page": page,
      "per_page": pageSize,
    }],
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

export async function typesenseRetrieveAllByUrl(
  urlList: { url: string }[],
): Promise<any> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);

  const urlSearches = urlList.slice(0, 20).map((rankedUrl) => ({
    "collection": process.env.TYPESENSE_DOCS_COLLECTION,
    "q": rankedUrl.url,
    "query_by": "url_without_anchor",
    "include_fields": "id,url_without_anchor,type,content_markdown",
    "filter_by": `url_without_anchor:=${rankedUrl.url}`,
    "group_by": "url_without_anchor",
    "group_limit": 1,
    "page": 1,
    "per_page": 1,
  }));

  const multiSearchArgs = { "searches": urlSearches };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

export async function setupSearchPhraseSchema(
  collectionNameTmp: string,
): Promise<void> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);
  const schema: CollectionCreateSchema = {
    "name": collectionNameTmp,
    "fields": [
      { "name": "doc_id", "type": "string", "optional": false },
      {
        "name": "url",
        "type": "string",
        "optional": false,
        "facet": true,
        "sort": true,
      },
      { "name": "search_phrase", "type": "string", "optional": false },
      {
        "name": "sort_order",
        "type": "int32",
        "optional": false,
        "sort": true,
      },
      {
        "name": "phrase_vec",
        "type": "float[]",
        "optional": true,
        "embed": {
          "from": ["search_phrase"],
          "model_config": {
            "model_name": "ts/all-MiniLM-L12-v2",
          },
        },
      },
      { "name": "language", "type": "string", "facet": true, "optional": true },
      { "name": "item_priority", "type": "int64", sort: true },
      { "name": "updated_at", type: "int64", sort: true, },
      { "name": "checksum", type: "string" },
      { "name": "prompt", type: "string", facet: true, optional: true, sort: true },
    ],
    "default_sorting_field": "sort_order",
    "token_separators": ["_", "-", "/"],
  };

  try {
    await client.collections(collectionNameTmp).retrieve();
  } catch (error) {
    if (error instanceof typesense.Errors.ObjectNotFound) {
      console.log("Creating new collection:", collectionNameTmp);
      await client.collections().create(schema);
      console.log("Collection created successfully.");
    } else {
      throw error;
    }
  }
}

export async function lookupSearchPhrases(
  url: string,
  collectionName?: string,
  prompt: string = "original"
): Promise<MultiSearchResponse<SearchPhraseEntry[]>> {
  const client = new typesense.Client(cfg.TYPESENSE_CONFIG);
  collectionName = collectionName ||
    process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION;

  const multiSearchArgs = {
    "searches": [{
      "collection": collectionName,
      "q": "*",
      "query_by": "url",
      "include_fields": "id,url,search_phrase,sort_order,updated_at,checksum",
      "filter_by": `url:=${url} && prompt:=${prompt}`,
      "sort_by": "sort_order:asc",
      "per_page": 30,
    }],
  };

  const response = await client.multiSearch.perform<SearchPhraseEntry[]>(multiSearchArgs, {});
  return response;
}
