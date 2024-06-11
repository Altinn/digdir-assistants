import { createPlaywrightRouter } from '@crawlee/playwright';
import { Locator } from '@playwright/test';
import TurndownService from 'turndown';
import sha1 from "sha1";
import { RagDoc, RagDocQuery, updateDocs, getDocChecksums, countTokens } from "@digdir/assistant-lib";

import { URL } from 'url';


const turndownService = new TurndownService();
const tokenCountWarningThreshold = 100;

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

async function getLinks(page) {
    const links = await page.$$eval('/*/a', ($posts) => {
        const scrapedData: { title: string; rank: string; href: string }[] = [];

        // We're getting the title, rank and URL of each post on Hacker News.
        $posts.forEach(($post) => {
            scrapedData.push({
                title: $post.querySelector('.title a').innerText,
                rank: $post.querySelector('.rank').innerText,
                href: $post.querySelector('.title a').href,
            });
        });

        return scrapedData;
    });
}

async function defaultHandler(collectionName: string, urlFilter: FilterUrlsToCrawl, { page, request, log, $$, crawler }) {
    
    log.info('Crawling ' + request.url);

    const locators = getLocators(request, page);
    const contents = await Promise.all(locators.map(async (locator) => {

        const elements = await locator.all();
        const innerHTMLs = await Promise.all(elements.map(element => element.innerHTML()));

        // extract links            
        const linksList = await Promise.all(elements.map(async (element) => {
            const linkElements = await element.getByRole('link').all();

            return await Promise.all(linkElements.map(link => link.getAttribute('href')));
        }));
        const links = linksList.flatMap(link => link);

        
        log.info(`All links: ${JSON.stringify(links)}`);

        const filteredUrls = urlFilter(links)
        log.info(`Filtered urls:\n${JSON.stringify(filteredUrls)}`);

        if (filteredUrls.length > 0) {
            log.info(`Adding ${filteredUrls.length} links:\n${JSON.stringify(filteredUrls)}`);
            await crawler.addRequests(filteredUrls.map((url: string) => { return { url: url }; }) );
        }
        
        return innerHTMLs.join("\n");            

    }));
    
    const markdown = turndownService.turndown(contents.join("\n\n"));
    

    const hash = sha1(request.url);
    log.info('Generating sha1 hash: ' + hash);

    const markdown_checksum = sha1(markdown);
    const url_without_anchor = new URL(request.url).origin + new URL(request.url).pathname;

    const updatedDoc: RagDoc = {
        id: hash,
        content_markdown: markdown,            
        url: url_without_anchor,            
        url_without_anchor: url_without_anchor,
        type: 'content',
        item_priority: 1,
        updated_at: Math.floor(new Date().getTime() / 1000),
        markdown_checksum: markdown_checksum,
        token_count: countTokens(markdown),
    }
    if (!markdown.trim()) {
        log.error(`No content extracted from '${url_without_anchor}'`);
        return;
    }
    if ((updatedDoc.token_count || 0) < tokenCountWarningThreshold) {
        log.warning(`Only ${updatedDoc.token_count} tokens extracted\n from ${url_without_anchor}\n consider verifying the locators for this url.`)
    }

    const currentDocs = await getDocChecksums(collectionName, [hash]);

    if (currentDocs && currentDocs.length > 0 
        && currentDocs[0].id == hash
        && currentDocs[0].markdown_checksum == markdown_checksum) {
        log.info(`Tokens: ${updatedDoc.token_count}, content checksums match, skipping update for url '${url_without_anchor}'`);
    } else {
        log.info(markdown);        
        await updateDocs([updatedDoc], collectionName);    
    }
}

function getLocators(request, page): Locator[] {
    
    const locatorMap = {
        "https://info.altinn.no/en/forms-overview/": [
            page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[3]/*/*')
                 .filter({hasNotText: "Start service"}),                
            page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[4]/*'),
            page.locator('//*[@id="picker-container"]/div[@class="a-page"]/div[1]/div[5]')    
        ],
        "https://info.altinn.no/en/start-and-run-business/support-schemes/": [
            page.locator('//*/body[1]/div[1]/div[1]')
        ],
        "https://info.altinn.no/en/start-and-run-business/": [
            page.locator('//*[@id="content"]/div')
        ],
        "https://info.altinn.no/en/help/": [
            page.locator('//html/body/div[@class="a-page"]/div[@class="container"]')
        ],
        "https://docs.altinn.studio/": [
            page.locator('//*[@id="body-inner"]')
        ],
        "https://github.com/Altinn/altinn-studio/releases": [
            page.locator('//*[@id="repo-content-turbo-frame"]/div/div[3]') // data-hpc
        ],
        "https://github.com/digdir/roadmap/issues/": [
            page.locator('//div[@class="js-discussion"]')
        ]
    }

    for (const url in locatorMap) {
        if (request.url.startsWith(url)) {
            return locatorMap[url];
        }
    }
    return [];        
}

