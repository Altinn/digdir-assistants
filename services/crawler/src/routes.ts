import { createPlaywrightRouter } from '@crawlee/playwright';
import { Locator } from '@playwright/test';
import TurndownService from 'turndown';
import sha1 from "sha1";
import { RagDoc, updateDocs, countTokens } from "@digdir/assistant-lib";

import { URL } from 'url';


const turndownService = new TurndownService();
const tokenCountWarningThreshold = 100;

export function createRouter(collectionName: string) {

    const router = createPlaywrightRouter();

    const localDefaultHandler = defaultHandler.bind(null, collectionName);

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

async function defaultHandler(collectionName: string, { page, request, log }) {
    
    log.info('Crawling ' + request.url);

    const locators = getLocators(request, page);
    const contents = await Promise.all(locators.map(async (locator) => {

        const elements = await locator.all();
        const innerHTMLs = await Promise.all(elements.map(element => element.innerHTML()));
        return innerHTMLs.join("\n");            

    }));
    
    const markdown = turndownService.turndown(contents.join("\n\n"));
    log.info(markdown);        

    const hash = sha1(request.url);
    log.info('Generating sha1 hash: ' + hash);

    const url_without_anchor = new URL(request.url).origin + new URL(request.url).pathname;

    const updatedDoc: RagDoc = {
        id: hash,
        content_markdown: markdown,            
        url: url_without_anchor,            
        url_without_anchor: url_without_anchor,
        type: 'content',
        item_priority: 1,
        updated_at: Math.floor(new Date().getTime() / 1000),
        markdown_checksum: sha1(markdown),
        token_count: countTokens(markdown),
    }
    if (!markdown.trim()) {
        log.error(`No content extracted from '${url_without_anchor}'`);
        return;
    }
    if ((updatedDoc.token_count || 0) < tokenCountWarningThreshold) {
        log.warning(`Only ${updatedDoc.token_count} tokens extracted\n from ${url_without_anchor}\n consider verifying the locators for this url.`)
    }

    await updateDocs([updatedDoc], collectionName);    
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
        ]
    }

    for (const url in locatorMap) {
        if (request.url.startsWith(url)) {
            return locatorMap[url];
        }
    }
    return [];        
}

