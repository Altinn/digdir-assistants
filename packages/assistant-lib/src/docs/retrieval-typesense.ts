import Typesense from "typesense";
import { CollectionCreateSchema } from "typesense/lib/Typesense/Collections";
import { QueryRelaxation } from "./query-relaxation";
import { typesenseConfig } from "../config/typesense";
import { envVar } from "../general";
import { flatMap } from "remeda";

const typesenseCfg = typesenseConfig();

export interface RankedUrl {
  url: string;
  rank: number;
}

export async function searchMultiple(relaxedQueries: QueryRelaxation) {
  if (!relaxedQueries || !relaxedQueries.searchQueries) {
    console.warn(`typesenseSearchMultiple() - search terms not provided`);
    return;
  }
  const client = new Typesense.Client(typesenseCfg);

  console.log(`incoming queries: ${relaxedQueries}`);

  const multiSearchArgs = {
    searches: relaxedQueries.searchQueries.map((query) => ({
      collection: envVar("TYPESENSE_DOCS_COLLECTION"),
      q: query,
      query_by: "content,embedding",
      include_fields:
        "hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,url_without_anchor,type,id,content_markdown",
      group_by: "url_without_anchor",
      group_limit: 3,
      limit: 10,
      prioritize_exact_match: false,
      sort_by: "_text_match:desc",
      drop_tokens_threshold: 5,
    })),
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

export async function lookupSearchPhrasesSimilar(
  relaxedQueries: QueryRelaxation,
): Promise<RankedUrl[]> {
  if (!relaxedQueries || !relaxedQueries.searchQueries) {
    console.warn(`typesenseSearchMultiple() - search terms not provided`);
    return [];
  }
  const client = new Typesense.Client(typesenseCfg);

  const multiSearchArgs = {
    searches: relaxedQueries.searchQueries.map((query) => ({
      collection: envVar("TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION"),
      q: query,
      query_by: "search_phrase,phrase_vec",
      include_fields: "search_phrase,url",
      group_by: "url",
      group_limit: 1,
      limit: 20,
      sort_by: "_text_match:desc,_vector_distance:asc",
      prioritize_exact_match: false,
      drop_tokens_threshold: 5,
    })),
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});

  if (envVar("LOG_LEVEL") === "debug") {
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

export async function retrieveAllUrls(page: number, pageSize: number) {
  const client = new Typesense.Client(typesenseCfg);

  const multiSearchArgs = {
    searches: [
      {
        collection: envVar("TYPESENSE_DOCS_COLLECTION"),
        q: "*",
        query_by: "url_without_anchor",
        include_fields: "url_without_anchor,content_markdown,id",
        group_by: "url_without_anchor",
        group_limit: 1,
        sort_by: "item_priority:asc",
        page: page,
        per_page: pageSize,
      },
    ],
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}

export async function retrieveAllByUrl(urlList: RankedUrl[]) {
  const client = new Typesense.Client(typesenseCfg);

  const urlSearches = urlList.slice(0, 20).map((rankedUrl) => ({
    collection: envVar("TYPESENSE_DOCS_COLLECTION"),
    q: rankedUrl["url"],
    query_by: "url_without_anchor",
    include_fields:
      "hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,url_without_anchor,type,id,content_markdown",
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

async function setupSearchPhraseSchema(collectionNameTmp: string) {
  const client = new Typesense.Client(typesenseCfg);
  const schema: CollectionCreateSchema = {
    name: collectionNameTmp,
    fields: [
      { name: "doc_id", type: "string", optional: false },
      { name: "url", type: "string", optional: false, facet: true, sort: true },
      { name: "search_phrase", type: "string", optional: false },
      { name: "sort_order", type: "int32", optional: false, sort: true },
      {
        name: "phrase_vec",
        type: "float[]",
        optional: true,
        embed: {
          from: ["search_phrase"],
          model_config: {
            model_name: "ts/all-MiniLM-L12-v2",
          },
        },
      },
      { name: "language", type: "string", facet: true, optional: true },
      { name: "item_priority", type: "int64" },
    ],
    default_sorting_field: "sort_order",
    token_separators: ["_", "-", "/"],
  };

  try {
    await client.collections(collectionNameTmp).retrieve();
  } catch (error) {
    if (error instanceof Typesense.Errors.ObjectNotFound) {
      await client.collections().create(schema);
    }
  }
}

async function lookupSearchPhrases(url: string, collectionName?: string) {
  const client = new Typesense.Client(typesenseCfg);
  if (!collectionName) {
    collectionName = envVar("TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION");
  }

  const multiSearchArgs = {
    searches: [
      {
        collection: collectionName,
        q: "*",
        query_by: "url",
        include_fields: "id,url,search_phrase,sort_order",
        filter_by: `url:=${url}`,
        sort_by: "sort_order:asc",
        per_page: 30,
      },
    ],
  };

  const response = await client.multiSearch.perform(multiSearchArgs, {});
  return response;
}
