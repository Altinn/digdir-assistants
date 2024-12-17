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


const cfg = config();
const encoding = get_encoding('cl100k_base');

main().catch(console.error);


async function main() {
  const program = new Command();
  program
    .name('kudosImportPublishers')
    .description(
      'Import KUDOS document publishers from a local MariaDB instance to an existing Typesense docs collections',
    )
    .version('0.1.0');

  program
    .requiredOption('--dbhost <string>', 'database host', '')
    .requiredOption('--dbuser <string>', 'database username', '')
    .requiredOption('--dbpass <string>', 'database password', '')
    .requiredOption('--dbname <string>', 'database name', '')
    .requiredOption('-c, --collection <string>', 'typesense collection name for documents (not alias name)', '')
    .option('--firstpage <number>', 'page number to start on (1-based)', '1')
    .option('--pagesize <number>', 'page size', '50')
    .option('--pages <number>', 'number of pages to import', '1')
    .option('-d, --dryrun', "don't make any changes in target typesense collection");

  program.parse(process.argv);
  const opts = program.opts();
  let docsCollectionName = opts.collection;
  let chunksCollectionName = opts.chunks;
  let docCollectionVerified = false;

  const typesenseClient = new Client(cfg.TYPESENSE_CONFIG);
  const docCollectionFound = await typesenseSearch.lookupCollectionByNameExact(docsCollectionName);

  if (!opts.dryrun) {
    if (!docCollectionFound) {
      console.error(
        `Collection '${docsCollectionName}' not found. Please import the docs collection first.`,
      );
      return;
    }

    if (docCollectionFound.name != docsCollectionName) {
      console.log(
        `Resolved alias '${docsCollectionName}' to collection '${docCollectionFound.name}'`,
      );
      docsCollectionName = docCollectionFound.name;
    }

    console.log(`Will update publisher names in collection: '${docsCollectionName}'`);
  }

  const connection = await mysql.createConnection({
    host: opts.dbhost,
    database: opts.dbname,
    user: opts.dbuser,
    password: opts.dbpass,
  });

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
    const query = `
    SELECT 
        dr.document_id,
        dr.actor_id,
        (SELECT name FROM actor_names WHERE actor_id = dr.actor_id AND type = 'display' LIMIT 1) as name_long,
        (SELECT name FROM actor_names WHERE actor_id = dr.actor_id AND type = 'abbreviation' LIMIT 1) as abbreviation,
        (SELECT name FROM actor_names WHERE actor_id = dr.actor_id AND type = 'official' LIMIT 1) as official
    FROM document_publisher dr
    LIMIT ${opts.pagesize} OFFSET ${(page - 1) * opts.pagesize}
  `;
    const [rowResults] = await connection.execute(query, [page, opts.pagesize]);

    const rows = rowResults as mysql.RowDataPacket[];
    // console.log(`query results metadata: ${JSON.stringify(metadata)}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    if (opts.pages >= 0 && page - opts.firstpage >= opts.pages) break;

    const updatedDocs = rows.map(row => ({
      id: row.document_id.toString(),
      publisher_short: row.abbreviation ? row.abbreviation : row.name_long,
      publisher_long: row.official ? row.official : row.name_long,
    }));
    console.log(`Updated docs: ${JSON.stringify(updatedDocs)}`);

    console.log(      
      opts.dryrun ? " Dryrun, won't upload to typesense" : ' Uploading...',
    );

    if (!opts.dryrun) {
      try {
        await typesenseClient
          .collections(docsCollectionName)
          .documents()
          .import(updatedDocs, { action: 'update' });

        console.log(`Updated publishers on page ${page}`);
      } catch (error) {
        console.error('Error updating publishers for docs:', error);
      }
    }
    page++;
  }

  await connection.end();
}

