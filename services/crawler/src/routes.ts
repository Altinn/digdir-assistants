import { createPlaywrightRouter } from '@crawlee/playwright';
import * as apifyLog from '@apify/log';
import { Locator } from '@playwright/test';
import TurndownService from 'turndown';
import sha1 from 'sha1';
import { get_encoding } from 'tiktoken';
import { RagDoc, RagChunk, updateDocs, updateChunks, getDocChecksums, findChunks, ImportResponse } from '@digdir/assistant-lib';
import { URL } from 'url';
import { flatMap } from 'remeda';

const turndownService = new TurndownService();
const tokenCountWarningThreshold = 20;

const chunkImportBatchSize = 40;
const maxChunkLength = 4000;
const minChunkLength = 3000;

const sectionDelim = '\n\n';
const sectionDelimLen = sectionDelim.length;

let sumTokens = 0;
let sumDocs = 0;
let sumChunks = 0;
let chunksCollectionName = '';

const encoding = get_encoding('cl100k_base');

type FilterUrlsToCrawl = (urls: string[]) => string[];

export function createRouter(collectionName: string, urlFilter: FilterUrlsToCrawl) {
  const router = createPlaywrightRouter();

  const localDefaultHandler = defaultHandler.bind(null, collectionName, urlFilter);

  router.addDefaultHandler(localDefaultHandler);

  // router.addHandler('detail', async ({ request, page, log, pushData }) => {
  //     const title = await page.title();
  //     log.info(`${title}`, { url: request.loadedUrl });

  //     await pushData({
  //         url: request.loadedUrl,
  //         title,
  //     });
  // });

  return router;
}

export async function defaultHandler(
  collectionName: string,
  urlFilter: FilterUrlsToCrawl,
  { page, request, log, crawler, pushData },
) {
  const startUrl = request.url;

  chunksCollectionName = collectionName.replace('docs', 'chunks');
  await page.waitForLoadState('networkidle');

  const fullPageUrl = page.url();

  const pageUrl_without_anchor = new URL(page.url()).origin + new URL(page.url()).pathname;
  if (pageUrl_without_anchor !== startUrl) {
    log.info(`Redirected from:\n${startUrl} to\n${fullPageUrl}`);

    await pushData({
      status: 'redirected',
      originalUrl: startUrl,
      url: pageUrl_without_anchor,
      title: await page.title(),
    });
  }

  const titleLocator = getTitleLocator(request, page);
  const titleElements = await Promise.all(
    titleLocator.map(async (locator) => {
      const elements = await locator.all();
      const textContents = await Promise.all(elements.map((element) => element.innerText()));
      log.info(`found title: ${textContents.join(' / ')}`);
      return textContents.join(' / ');
    }),
  );
  const title = titleElements.join(" / ");  

  const contentLocators = getContentLocators(request, page);

  log.info(`contentLocators: ${contentLocators.map(locator => locator.toString())}`);

  const contents = await Promise.all(
    contentLocators.map(async (locator) => {
      const elements = await locator.all();      
      const innerHTMLs = await Promise.all(elements.map((element) => element.innerHTML()));

      // extract links
      const linksList = await Promise.all(
        elements.map(async (element) => {
          const linkElements = await element.getByRole('link').all();

          return await Promise.all(linkElements.map((link) => link.getAttribute('href')));
        }),
      );      
      
      // const links = flatMap(linksList, (link) => link).filter((link) => link !== null) as string[];

      // const filteredUrls = urlFilter(links);

      // if (filteredUrls.length > 0) {
      //   log.info(`Adding ${filteredUrls.length} links:\n${JSON.stringify(filteredUrls)}`);
      //   await crawler.addRequests(
      //     filteredUrls.map((url: string) => {
      //       return { url: url || '' };
      //     }),
      //   );
      // }

      return innerHTMLs.join('\n');
    }),
  );

  const markdown = turndownService.turndown(contents.join('\n\n'));

  const markdown_checksum = sha1(markdown);
  const urlHash = sha1(pageUrl_without_anchor);
  const tokens = encoding.encode(markdown);
  sumTokens += tokens.length;

  sumDocs += 1;

  const updatedDoc: RagDoc = {
    id: '' + urlHash,
    doc_num: '' + urlHash,
    uuid: '' + urlHash,
    title: title,
    url: pageUrl_without_anchor,
    url_without_anchor: pageUrl_without_anchor,
    source_document_url: pageUrl_without_anchor,
    source_updated_at: new Date().toISOString(),
    type: 'content',
    item_priority: 1,
    updated_at: Math.floor(new Date().getTime() / 1000),
    markdown_checksum: markdown_checksum,
  };
  if (!markdown.trim()) {
    log.error(`No content extracted from '${pageUrl_without_anchor}'`);
    return;
  }
  const currentDocs = await getDocChecksums(collectionName, [urlHash]);

  if (
    currentDocs &&
    currentDocs.length > 0 &&
    currentDocs[0].id == urlHash &&
    currentDocs[0].markdown_checksum == markdown_checksum
  ) {
    if (currentDocs[0].url_without_anchor != pageUrl_without_anchor) {
      log.warning(
        `Possible redirect, not updating yet...\noriginal url: ${currentDocs[0].url_without_anchor}\nnew url:   ${pageUrl_without_anchor}`,
      );
    } else {
      log.info(`  [NO CHANGE] tokens: ${tokens.length}, No change for url: ${pageUrl_without_anchor}`);
    }
  } else {
    log.info(`[UPDATED] tokens: ${tokens.length}, Updating doc for url '${pageUrl_without_anchor}'`);

    const docResults = await updateDocs([updatedDoc], collectionName);

    const failedDocs = docResults.filter((result: any) => !result.success);
    if (failedDocs.length > 0) {
      log.error(
        `Upsert to typesense failed for the following urls:\n${failedDocs}`,
      );
    }

    const chunkResults = await chunkDocContents(markdown, urlHash, log);
    const failedChunks = chunkResults.filter((result: any) => !result.success);
    if (failedChunks.length > 0) {
      log.error(
        `Upsert to typesense failed for the following urls:\n${failedChunks}`,
      );
    }
  }

  await pushData({
    status: 'success',
    tokens: tokens.length,
    url: pageUrl_without_anchor,
    title: await page.title(),
  });

  log.info(`    -- tokens: ${sumTokens}, docs: ${sumDocs}, chunks: ${sumChunks}`);

}

async function chunkDocContents(markdown: string, urlHash: string, log: apifyLog.Log) {

  const chunkLengths = await findChunks(
    markdown,
    sectionDelim,
    minChunkLength,
    maxChunkLength,
  );

  sumChunks += chunkLengths.length;
  let batch: RagChunk[] = [];

  if ((chunkLengths.length || 0) < tokenCountWarningThreshold) {
    log.warning(
      `Only ${chunkLengths.length} tokens extracted\n from doc_num ${urlHash}\n consider verifying the locators for this url.`,
    );
  } else {
    log.info(`   Found ${chunkLengths.length} chunks, uploading...`)
  }

  let allChunkResults: ImportResponse[] = [];

  let chunkStart = 0;
  for (let chunkIndex = 0; chunkIndex < chunkLengths.length; chunkIndex++) {
    const chunkText = markdown.substring(chunkStart, chunkLengths[chunkIndex]);
    const tokens = encoding.encode(chunkText);
    sumTokens += tokens.length;
    log.info(
      `  -- doc_num: ${urlHash}, chunk_index: ${chunkIndex + 1} of ${chunkLengths.length} ` +
      `-- tokens: ${tokens.length} -- length: ${chunkLengths[chunkIndex] - chunkStart} ---------------`,
    );
    // log.info(chunkText);
    chunkStart = chunkLengths[chunkIndex] + 1;

    const markdown_checksum = sha1(chunkText);

    const outChunk: RagChunk = {
      id: urlHash + '-' + chunkIndex,
      doc_num: '' + urlHash,
      chunk_id: urlHash + '-' + chunkIndex,
      chunk_index: chunkIndex,
      content_markdown: chunkText,
      url: urlHash + '-' + chunkIndex,
      url_without_anchor: urlHash + '-' + chunkIndex,
      type: 'content',
      item_priority: 1,
      language: 'no',
      updated_at: Math.floor(Date.now() / 1000),
      markdown_checksum: markdown_checksum,
      token_count: tokens.length,
    };
    batch.push(outChunk);

    if (batch.length === chunkImportBatchSize || chunkIndex === chunkLengths.length - 1) {

      log.info(`Uploading ${batch.length} chunks for doc id ${urlHash}`);

      log.info(`Batch[0]: ${JSON.stringify(batch[0], null, 2)}`);

      const results = await updateChunks(batch, chunksCollectionName)
      allChunkResults = allChunkResults.concat(results);

      const failedResults = results.filter((result: any) => !result.success);
      if (failedResults.length > 0) {
        log.error(
          `Upsert to typesense failed for the following urls:\n${failedResults}`,
        );
      }

      batch = [];
    }
  }
  return allChunkResults;
}

// TODO: add a locator for getting the title from a Studio doc url
//  full xpath to links selector: /html/body/div[2]/div/div[2]/div[1]/section/div[1]/div[2]/div[1]/div/span[2]
// section #body, div #content, div #top-bar, div #breadcrumbs, .links

function getContentLocators(request, page): Locator[] {
  const locatorMap = {
    'https://info.altinn.no/en/forms-overview/': [
      page
        .locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[3]/*/*')
        .filter({ hasNotText: 'Start service' }),
      page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[4]/*'),
      page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[5]'),
    ],
    'https://info.altinn.no/en/start-and-run-business/support-schemes/': [
      page.locator('//*/body[1]/div[1]/div[1]'),
    ],
    'https://info.altinn.no/en/start-and-run-business/': [page.locator('//*[@id="content"]/div')],
    'https://info.altinn.no/en/help/': [
      page.locator('//html/body/div[@class="a-page"]/div[@class="container"]'),
    ],
    'https://docs.altinn.studio/': [page.locator('//*[@id="body-inner"]')],
    'https://github.com/Altinn/altinn-studio/issues/': [page.locator('//div[@data-turbo-frame]')],
    'https://github.com/Altinn/altinn-studio/releases': [
      page.locator('//*[@id="repo-content-turbo-frame"]/div[1]'), // data-hpc
    ],
    'https://github.com/digdir/roadmap/issues/': [page.locator('//div[@data-turbo-frame"]')],    
    'https://www.digdir.no/kunstig-intelligens/': [
      // page.locator('/html/body/div[2]/div/main/div/article/div/div/div/div[2]'),
      page.locator('//*/div[@class="modules node-page__modules"]')
    ]
  };

  for (const url in locatorMap) {
    if (request.url.startsWith(url)) {      
      return locatorMap[url];
    }
  }
  return [];
}

function getTitleLocator(request, page): Locator[] {

  const locatorMap = {
    'https://docs.altinn.studio/': [page.locator('//*/div[@id="breadcrumbs"]/span[@class="links"]/a')],
    'https://info.altinn.no/en/forms-overview/': [page.locator('//*/section[@id="content"]/*/ol[@class="a-breadcrumb"]')],
    'https://www.digdir.no/kunstig-intelligens/': [page.locator('//*/h1[@class="node-page__title fds-typography-heading-xlarge"]')]
  }
  for (const url in locatorMap) {
    if (request.url.startsWith(url)) {
      return locatorMap[url];
    }
  }
  return [];
}

export async function failedRequestHandler({ request, pushData }) {
  // This function is called when the crawling of a request failed too many times
  await pushData({
    url: request.url,
    status: 'failed',
    errors: request.errorMessages,
  });
}

