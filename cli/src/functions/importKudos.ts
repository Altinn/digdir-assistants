import mysql from 'mysql2/promise';
import { Client, Errors } from 'typesense';
import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections.js';
import { Command } from 'commander';
import { config } from '../lib/config';
import * as typesenseSearch from '../lib/typesense-search';
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
  fields: [
    { name: "doc_num", type: 'string', facet: true, optional: false, sort: true },
    { name: 'updated_at', type: 'int64', optional: false, sort: true },
    { name: 'uuid', type: 'string' },
    { name: 'type', type: 'string', facet: true, optional: true },
    { name: 'title', type: 'string', optional: true, sort: true },
    { name: 'subtitle', type: 'string', optional: true },
    { name: 'isbn', type: 'string', optional: true },
    { name: 'abstract', type: 'string', optional: true },
    { name: 'language', type: 'string', optional: true },
    { name: 'source_document_type', type: 'string', optional: true },
    { name: 'source_document_url', type: 'string', optional: true },
    { name: 'source_page_url', type: 'string', optional: true },
    { name: 'source_published_at', type: 'string', optional: false, sort: true },
    { name: 'source_created_at', type: 'string', optional: true, sort: true },
    { name: 'source_updated_at', type: 'string', optional: true, sort: true },
    { name: 'kudos_published_at', type: 'string', optional: true },
    { name: 'kudos_unpublishable_at', type: 'string', optional: true },
    { name: 'kudos_unpublished_at', type: 'string', optional: true },
  ],
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
    name: 'kudos_chunks',
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
      'Import KUDOS documents from a local MariaDB instance to two Typesense collections',
    )
    .version('0.1.0');

  program
    .requiredOption('--dbhost <string>', 'database host', '')
    .requiredOption('--dbuser <string>', 'database username', '') 
    .requiredOption('--dbpass <string>', 'database password', '')
    .requiredOption('--dbname <string>', 'database name', '')
    .requiredOption('-c, --collection <string>', 'typesense collection name for documents (not alias name)', '')
    .option('--chunks <string>', 'typesense collection name for document chunks (not alias name)', '')
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
    } else {
      if (!docCollectionFound) {
        console.error(
          `Collection '${docsCollectionName}' not found. To create, use the '-n' option.`,
        );
        return;
      }
      if (!chunkCollectionFound) {
        console.error(`Kudos doc chunk collection '${chunksCollectionName}' not found, aborting.`);
        return;
      }

      if (docCollectionFound.name != docsCollectionName) {
        console.log(
          `Resolved alias '${docsCollectionName}' to collection '${docCollectionFound.name}'`,
        );
        docsCollectionName = docCollectionFound.name;
      }
      if (chunkCollectionFound.name != chunksCollectionName) {
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
        "WHERE ((type = 'Tildelingsbrev') OR (type = 'Evaluering') OR  (type = 'Årsrapport')) " +
        " AND (published_at > '2020-01-01 00:00:00.000') " + 
        " AND (published_at < '2024-01-01 00:00:00.000') " +
        //" ORDER BY published_at asc " +
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
      const chunkLengths = await findChunks(
        plaintextDecompressed,
        sectionDelim,
        minChunkLength,
        maxChunkLength,
      );
      sumChunks += chunkLengths.length;
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
        `Doc id: ${row.id} has ${chunkLengths.length} chunks.`,
        opts.dryrun ? " Dryrun, won't upload to typesense" : ' Uploading...',
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

        if (!opts.dryrun) {
          if (batch.length == 0) {
            console.log(`No chunks found for doc_num: ${row.id}`);
          } else if (
            batch.length === chunkImportBatchSize 
            || chunkIndex === chunkLengths.length - 1) {
            console.log(`Uploading ${batch.length} chunks for doc id ${row.id}`);
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

