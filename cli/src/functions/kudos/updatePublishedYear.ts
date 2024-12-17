import mysql from 'mysql2/promise';
import { Client, Errors } from 'typesense';
import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections.js';
import { Command } from 'commander';
import { config } from '../../lib/config';
import * as typesenseSearch from '../../lib/typesense-search';
import { get_encoding } from 'tiktoken';


const cfg = config();
const encoding = get_encoding('cl100k_base');

main().catch(console.error);


async function main() {
  const program = new Command();
  program
    .name('KUDOS updatePublishedYear')
    .description(
      'Update the source_published_year field in the specified Typesense docs collections',
    )
    .version('0.1.0');

  program
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

    console.log(`Will update 'source_published_year' in collection: '${docsCollectionName}'`);
  }

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
    
    const searchParameters = {
      q: '*',
      query_by: 'doc_num',
      sort_by: 'doc_num:asc',
      page: page,
      per_page: parseInt(opts.pagesize),
      include_fields: 'doc_num,source_published_at',
    };

    const searchResults = await typesenseClient
      .collections(docsCollectionName)
      .documents()
      .search(searchParameters);

    if (searchResults.hits.length === 0) {
      console.log(`No results for page ${page}`);
      break;
    }

    const docs = searchResults.hits.map(hit => ({
      doc_num: hit.document.doc_num,
      source_published_at: hit.document.source_published_at,
    }));

    if (docs.length === 0) {
      console.log(`No more data on page ${page}, exiting.`);
      break;
    }
    if (opts.pages >= 0 && page - opts.firstpage >= opts.pages) {
      console.log(`Done importing ${opts.pages} pages as requested, exiting.`);
      break;
    }

    console.log(`Retrieved ${docs.length} documents from Typesense...`);

    const updatedDocs = docs.map(doc => ({
      id: doc.doc_num.toString(),
      source_published_year: (doc.source_published_at && doc.source_published_at.length >= 4)
        ? doc.source_published_at.substring(0, 4)
        : null,
    }));
    console.log(`Updated docs: ${JSON.stringify(updatedDocs)}`);

    console.log(
      opts.dryrun ? ' Dryrun, won\'t upload to typesense' : ' Uploading...',
    );

    if (!opts.dryrun) {
      try {
        await typesenseClient
          .collections(docsCollectionName)
          .documents()
          .import(updatedDocs, { action: 'update' });

        console.log(`Updated 'source_published_year' for ${updatedDocs.length} docs on page ${page}`);
      } catch (error) {
        console.error('Error updating \'source_published_year\' for docs:', error);
      }
    }
    page++;
  }
}

