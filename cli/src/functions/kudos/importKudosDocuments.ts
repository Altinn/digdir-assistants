import mysql from 'mysql2/promise';
import { Client, Errors } from 'typesense';
import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections.js';
import { Command } from 'commander';
import { config } from '../../lib/config';
import * as typesenseSearch from '../../lib/typesense-search';
import { z } from 'zod';
import sha1 from 'sha1';
import zlib from 'zlib';
import { get_encoding } from 'tiktoken';
import { findChunks } from '@digdir/assistant-lib';

// create a document schema i Typesense that matches the following MariaDB table schema:

/*

CREATE TABLE `documents` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` char(36) NOT NULL,
  `type` varchar(255) DEFAULT NULL,
  `title` text DEFAULT NULL,
  `subtitle` text DEFAULT NULL,
  `original_title` text DEFAULT NULL,
  `isbn` varchar(255) DEFAULT NULL,
  `isbn_printed` varchar(255) DEFAULT NULL,
  `issn` varchar(255) DEFAULT NULL,
  `redirect_to_id` int(11) DEFAULT NULL,
  `additional_urns` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`additional_urns`)),
  `series_name` varchar(255) DEFAULT NULL,
  `series_number` varchar(255) DEFAULT NULL,
  `abstract` text DEFAULT NULL,
  `plaintext` longblob DEFAULT NULL,
  `language` varchar(255) DEFAULT NULL,
  `source_document_type` varchar(255) DEFAULT NULL,
  `source_document_url` text DEFAULT NULL,
  `source_page_url` text DEFAULT NULL,
  `source_public_note` text DEFAULT NULL,
  `has_thesis` tinyint(1) DEFAULT NULL,
  `has_recommendations` tinyint(1) DEFAULT NULL,
  `project_start_at` date DEFAULT NULL,
  `project_end_at` date DEFAULT NULL,
  `concerned_year` smallint(6) DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `kudos_published_at` datetime DEFAULT NULL,
  `kudos_unpublishable_at` datetime DEFAULT NULL,
  `kudos_unpublished_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `documents_type_index` (`type`),
  KEY `documents_title_index` (`title`(768)),
  KEY `documents_subtitle_index` (`subtitle`(768)),
  KEY `documents_isbn_index` (`isbn`),
  KEY `documents_issn_index` (`issn`),
  KEY `documents_uuid_index` (`uuid`),
  KEY `documents_kudos_published_at_index` (`kudos_published_at`),
  KEY `documents_redirect_to_id_index` (`redirect_to_id`),
  KEY `documents_kudos_unpublished_at_index` (`kudos_unpublished_at`),
  KEY `documents_published_at_index` (`published_at`)
) ENGINE=InnoDB AUTO_INCREMENT=95267 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

*/

const kudosDocTypesenseSchema: CollectionCreateSchema = {
  name: 'documents',
  symbols_to_index: ["_"],
  token_separators: ['-', '/'],
  default_sorting_field: "doc_num",
  enable_nested_fields: false,
  fields: [
    {
      "name": "doc_num",
      "facet": true,
      "sort": true,
      "type": "string"
    },
    {
      "name": "url_without_anchor",
      "facet": true,
      "type": "string"
    },
    {
      "name": "updated_at",
      "sort": true,
      "type": "int64"
    },
    {
      "name": "uuid",
      "type": "string"
    },
    {
      "name": "title",
      "facet": true,
      "optional": true,
      "sort": true,
      "type": "string"
    },
    {
      "name": "subtitle",
      "optional": true,
      "type": "string"
    },
    {
      "name": "isbn",
      "optional": true,
      "type": "string"
    },
    {
      "name": "abstract",
      "optional": true,
      "type": "string"
    },
    {
      "name": "language",
      "optional": true,
      "type": "string"
    },
    {
      "name": "source_document_type",
      "facet": true,
      "optional": true,
      "sort": true,
      "type": "string"
    },
    {
      "name": "source_document_url",
      "optional": true,
      "type": "string"
    },
    {
      "name": "source_page_url",
      "optional": true,
      "type": "string"
    },
    {
      "name": "source_published_at",
      "sort": true,
      "type": "string"
    },
    {
      "name": "source_published_year",
      "facet": true,
      "sort": true,
      "optional": true,
      "type": "string"
    },
    {
      "name": "source_created_at",
      "optional": true,
      "sort": true,
      "type": "string"
    },
    {
      "name": "source_updated_at",
      "optional": true,
      "sort": true,
      "type": "string"
    },
    {
      "name": "kudos_published_at",
      "optional": true,
      "type": "string"
    },
    {
      "name": "kudos_unpublishable_at",
      "optional": true,
      "type": "string"
    },
    {
      "name": "department_short",
      "facet": true,
      "optional": true,
      "type": "string[]"
    },
    {
      "name": "department_long",
      "facet": true,
      "optional": true,
      "type": "string[]"
    },
    {
      "name": "orgs_short",
      "facet": true,
      "optional": true,
      "type": "string[]"
    },
    {
      "name": "orgs_long",
      "facet": true,
      "optional": true,
      "type": "string[]"
    },
    {
      "facet": true,
      "name": "publisher_short",
      "optional": true,
      "type": "string"
    },
    {
      "facet": true,
      "name": "publisher_long",
      "optional": true,
      "type": "string"
    },
    {
      "facet": true,
      "name": "recipient_short",
      "optional": true,
      "type": "string"
    },
    {
      "facet": true,
      "name": "recipient_long",
      "optional": true,
      "type": "string"
    },
    {
      "facet": true,
      "name": "type",
      "optional": true,
      "sort": true,
      "type": "string"
    },
    {
      "facet": true,
      "name": "owner_short",
      "optional": true,
      "type": "string"
    },
    {
      "facet": true,
      "name": "owner_long",
      "optional": true,
      "type": "string"
    }
  ]
};

const KudosDocSchema = z.object({
  id: z.string().optional(),
  doc_num: z.string(),
  url_without_anchor: z.string(),
  updated_at: z.number(),
  uuid: z.string(),
  type: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  isbn: z.string().optional(),
  abstract: z.string().optional(),
  language: z.string().optional(),
  source_document_type: z.string().optional(),
  source_document_url: z.string().optional(),
  source_page_url: z.string().optional(),
  source_published_at: z.string().optional(),
  kudos_published_at: z.string().optional(),
  kudos_unpublishable_at: z.string().optional(),
  kudos_unpublished_at: z.string().optional(),
  source_created_at: z.string().optional(),
  source_updated_at: z.string().optional(),
});

type KudosDoc = z.infer<typeof KudosDocSchema>;

const KudosChunkSchema = z.object({
  id: z.string().optional(),
  doc_num: z.string(),
  chunk_id: z.string(),
  chunk_index: z.number(),
  content_markdown: z.string(),
  url: z.string(),
  url_without_anchor: z.string(),
  type: z.string(),
  item_priority: z.number(),
  language: z.string(),
  updated_at: z.number(),
  markdown_checksum: z.string(),
  token_count: z.number(),
});
type KudosChunk = z.infer<typeof KudosChunkSchema>;

const kudosChunkTypesenseSchema = (
  docsCollectionName: string,
): CollectionCreateSchema => {
  return {
    name: docsCollectionName.replace('docs', 'phrases'),
    "fields": [
      {
        "facet": false,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "chunk_id",
        "optional": false,
        "sort": true,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": false,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "doc_num",
        "optional": false,
        "reference": docsCollectionName + ".doc_num",
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "chunk_index",
        "optional": false,
        "sort": true,
        "stem": false,
        "store": true,
        "type": "int32"
      },
      {
        "facet": false,
        "index": true,
        "infix": false,
        "locale": "no",
        "name": "content_markdown",
        "optional": false,
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "url",
        "optional": false,
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "url_without_anchor",
        "optional": false,
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "en",
        "name": "type",
        "optional": false,
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": false,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "item_priority",
        "optional": false,
        "sort": true,
        "stem": false,
        "store": true,
        "type": "int64"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "updated_at",
        "optional": false,
        "sort": true,
        "stem": false,
        "store": true,
        "type": "int64"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "language",
        "optional": false,
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": false,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "markdown_checksum",
        "optional": true,
        "sort": false,
        "stem": false,
        "store": true,
        "type": "string"
      },
      {
        "facet": true,
        "index": true,
        "infix": false,
        "locale": "",
        "name": "token_count",
        "optional": true,
        "sort": true,
        "stem": false,
        "store": true,
        "type": "int64"
      }
    ],
    default_sorting_field: 'chunk_index',
  }
};

const cfg = config();
const encoding = get_encoding('cl100k_base');

main().catch(console.error);

async function main() {
  const program = new Command();
  program
    .name('kudosImport')
    .description(
      'Import KUDOS documents and chunks (optional) from a local MariaDB instance to Typesense collection(s)',
    )
    .version('0.2.0');

  program
    .requiredOption('--dbhost <string>', 'database host', '')
    .requiredOption('--dbuser <string>', 'database username', '')
    .requiredOption('--dbpass <string>', 'database password', '')
    .requiredOption('--dbname <string>', 'database name', '')
    .requiredOption('-c, --collection <string>', 'typesense collection name for documents (not alias name)', '')
    .option('--chunks <string>', 'typesense collection name for document chunks (not alias name)', '')
    .option('--importchunks', 'import chunks from Kudos DB')
    .option('--firstpage <number>', 'page number to start on (1-based)', '1')
    .option('--pagesize <number>', 'page size', '10')
    .option('--pages <number>', 'number of pages to import', '1')
    .option('-n', 'create new collection')
    .option('-d, --dryrun', "don't make any changes in target typesense collection");

  program.parse(process.argv);
  const opts = program.opts();
  let docsCollectionName = opts.collection;
  let chunksCollectionName = opts.chunks;
  let docCollectionVerified = false;

  const typesenseClient = new Client(cfg.TYPESENSE_CONFIG);
  const docCollectionFound = await typesenseSearch.lookupCollectionByNameExact(docsCollectionName);

  if (!chunksCollectionName) {
    chunksCollectionName = docsCollectionName.replace('docs', 'chunks');
  }
  const chunkCollectionFound =
    await typesenseSearch.lookupCollectionByNameExact(chunksCollectionName);

  if (!opts.dryrun) {
    if (opts.n) {
      if (docCollectionFound) {
        console.error(`Collection '${docsCollectionName}' already exists, aborting.`);
        return;
      } else {
        // create new collection
        try {
          await typesenseClient.collections(docsCollectionName).retrieve();
        } catch (error) {
          if (error instanceof Errors.ObjectNotFound) {
            if (!opts.dryrun) {
              console.log('Creating new collection:', docsCollectionName);
              kudosDocTypesenseSchema.name = docsCollectionName;
              await typesenseClient.collections().create(kudosDocTypesenseSchema);
              console.log(`Kudos doc collection ${docsCollectionName} created successfully.`);
            } else {
              console.log(`Dry run, won't attempt to create new docs collection '${docsCollectionName}'`)
            }
          } else {
            throw error;
          }
        }
      }
      if (opts.importchunks) {
        if (chunkCollectionFound) {
          console.error(`Chunck collection '${chunksCollectionName}' already exists, aborting.`);
          return;
        } else {
          // create new collection
          try {
            await typesenseClient.collections(chunksCollectionName).retrieve();
          } catch (error) {
            if (error instanceof Errors.ObjectNotFound) {
              console.log('Creating new collection:', chunksCollectionName);
              let chunkSchema = kudosChunkTypesenseSchema(docsCollectionName);
              await typesenseClient.collections().create(chunkSchema);
              console.log(`Kudos chunk collection ${chunksCollectionName} created successfully.`);
            } else {
              throw error;
            }
          }
        }
      }
    } else {
      if (!docCollectionFound) {
        console.error(
          `Collection '${docsCollectionName}' not found. To create, use the '-n' option.`,
        );
        return;
      }
      if (opts.importchunks && !chunkCollectionFound) {
        console.error(`Kudos doc chunk collection '${chunksCollectionName}' not found, aborting.`);
        return;
      }

      if (docCollectionFound.name != docsCollectionName) {
        console.log(
          `Resolved alias '${docsCollectionName}' to collection '${docCollectionFound.name}'`,
        );
        docsCollectionName = docCollectionFound.name;
      }
      if (opts.importchunks && chunkCollectionFound 
        && chunkCollectionFound.name != chunksCollectionName) {
        console.log(
          `Resolved alias '${chunksCollectionName}' to collection '${chunkCollectionFound.name}'`,
        );
        chunksCollectionName = chunkCollectionFound.name;
      }

      console.log(`Will update documents in collection: '${docsCollectionName}'`);
    }
  }

  const connection = await mysql.createConnection({
    host: opts.dbhost,
    database: opts.dbname,
    user: opts.dbuser,
    password: opts.dbpass,
  });

  const chunkImportBatchSize = 40;
  const maxChunkLength = 4000;
  const minChunkLength = 3000;
  let page = opts.firstpage;
  const sectionDelim = '\n\n';
  const sectionDelimLen = sectionDelim.length;
  console.log(`Delim: ${sectionDelim}, delim length: ${sectionDelimLen}`);

  console.log(`Opts:\n${JSON.stringify(opts)}`);
  // return;

  let sumTokens = 0;
  let sumDocs = 0;
  let sumChunks = 0;

  while (true) {
    console.log(`Loading ${opts.pagesize} documents from page ${page}`);
    const [rowResults] = await connection.execute(
      "SELECT * FROM documents " +
      "WHERE " +
      " (id IN (30965,2649,33169,16133,22084,8322,17306,29980,26024,30832,26803,32613,90487,302," +
      "30010,32351,16940,90715,16801,32643,7024,2216,5221,30977,5454,30776,24488,27207,31119,31994," +
      "32001,4240,30009,30975,14660,24753,32421,30963,22742,30967,32418,22302,24901,2421,2329,32062," +
      "90757))" +
      // "((type = 'Tildelingsbrev') OR (type = 'Årsrapport'))" +
      // "(type = 'Evaluering') OR " +
      // "(type = 'Årsrapport') OR +
      // "(type = 'Instruks')) " +
      //  " AND (published_at > '2020-01-01 00:00:00.000') " +
      //  " AND (published_at < '2025-01-01 00:00:00.000') " +
      " ORDER BY published_at asc " +
      " LIMIT ? OFFSET ?",
      [opts.pagesize, (page - 1) * opts.pagesize],
    );
    const rows = rowResults as mysql.RowDataPacket[];
    // console.log(`query results metadata: ${JSON.stringify(metadata)}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    if (opts.pages >= 0 && page - opts.firstpage >= opts.pages) break;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const plaintextCompressed = row.plaintext ? row.plaintext.toString('utf8') : null;

      if (!plaintextCompressed) {
        console.warn(`Skipping doc id: ${row.id}, plaintext column was empty.`);
        continue;
      }

      let plaintextDecompressed;
      try {
        plaintextDecompressed = zlib.inflateSync(row.plaintext).toString('utf8');
      } catch (error) {
        console.error(`Error decompressing plaintext for doc uuid '${row.uuid}':\n`, error);
        continue;
      }

      let chunkLengths: number[] = [];

      if (opts.importchunks) {
        chunkLengths = await findChunks(
          plaintextDecompressed,
          sectionDelim,
          minChunkLength,
          maxChunkLength,
        );
        sumChunks += chunkLengths.length;
      }
      sumDocs += 1;

      const doc: KudosDoc = {
        id: '' + row.id,
        doc_num: '' + row.id,
        uuid: row.uuid,
        url_without_anchor: row.source_document_url ? row.source_document_url : "https://unknown",
        updated_at: Math.floor(new Date().getTime() / 1000),
        type: row.type,
        title: row.title,
        subtitle: row.subtitle,
        isbn: row.isbn,
        abstract: row.abstract,
        language: 'no',
        source_document_type: row.source_document_type,
        source_document_url: row.source_document_url,
        source_page_url: row.source_page_url,
        source_published_at: row.published_at ? row.published_at.toISOString() : null,
        source_created_at: row.created_at ? row.created_at.toISOString() : null,
        source_updated_at: row.updated_at ? row.updated_at.toISOString() : null,
        kudos_published_at: row.kudos_published_at ? row.kudos_published_at.toISOString() : null,
        kudos_unpublishable_at: row.kudos_unpublishable_at
          ? row.kudos_unpublishable_at.toISOString()
          : null,
        kudos_unpublished_at: row.kudos_unpublished_at
          ? row.kudos_unpublished_at.toISOString()
          : null,
      };
      console.log(
        `Parsed doc_num: ${row.id}.`,
        opts.dryrun ? " Dryrun, won't upload to typesense" :
          opts.importchunks ? ` Uploading doc and ${chunkLengths.length} chunks...` : ` Uploading doc only...`,
      );
      if (!opts.dryrun) {
        await typesenseClient
          .collections(docsCollectionName)
          .documents()
          .import([doc], { action: 'upsert' });
      }

      let batch: KudosChunk[] = [];

      let chunkStart = 0;
      for (let chunkIndex = 0; chunkIndex < chunkLengths.length; chunkIndex++) {
        const chunkText = plaintextDecompressed.substring(chunkStart, chunkLengths[chunkIndex]);
        const tokens = encoding.encode(chunkText);
        sumTokens += tokens.length;
        console.log(
          `--- Doc id: ${row.id}, chunk: ${chunkIndex + 1} of ${chunkLengths.length} -- Tokens: ${tokens.length} -- Length: ${chunkLengths[chunkIndex] - chunkStart} ------------------------`,
        );
        // console.log(chunkText);
        chunkStart = chunkLengths[chunkIndex] + 1;

        const markdown_checksum = sha1(chunkText);

        const outChunk: KudosChunk = {
          id: '' + row.id + '-' + chunkIndex,
          chunk_id: '' + row.id + '-' + chunkIndex,
          doc_num: '' + row.id,
          chunk_index: chunkIndex,
          content_markdown: chunkText,
          url: row.id + '-' + chunkIndex,
          url_without_anchor: '' + row.id + '-' + chunkIndex,
          type: 'content',
          item_priority: 1,
          language: 'no',
          updated_at: Math.floor(new Date().getTime() / 1000),
          markdown_checksum: markdown_checksum,
          token_count: tokens.length,
        };

        batch.push(outChunk);

        if (!opts.dryrun && opts.importchunks) {
          if (batch.length == 0) {
            console.log(`No chunks found for doc_num: ${row.id}`);
          } else if (
            batch.length === chunkImportBatchSize
            || chunkIndex === chunkLengths.length - 1) {
            console.log(`Uploading ${batch.length} chunks for doc_num ${row.id}`);
            await typesenseClient
              .collections(chunksCollectionName)
              .documents()
              .import(batch, { action: 'upsert' });
            batch = [];
          }
        }
      }
    }
    page++;
  }

  console.log(`Stats -- tokens: ${sumTokens}, docs: ${sumDocs}, chunks: ${sumChunks}`);

  await connection.end();
}

