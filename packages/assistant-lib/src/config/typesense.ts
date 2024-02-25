import { envVar } from '../general';


type TypesenseNodeConfig = {
    host: string;
    port: number;
    protocol: string;
};

type TypesenseServiceConfig = {
    nodes: TypesenseNodeConfig[]
    connectionTimeoutSec: number;
    apiKey: string;
    docsCollection: string;
    docsSearchPhraseCollection: string;
};


export function typesenseConfig(): TypesenseServiceConfig {


    const cfg: TypesenseServiceConfig = {
        nodes: [{
            host: envVar("TYPESENSE_API_HOST"),
            port: 443, protocol: "https"
        }],
        apiKey: envVar("TYPESENSE_API_KEY"),
        docsCollection: envVar("TYPESENSE_DOCS_COLLECTION"),
        docsSearchPhraseCollection: envVar("TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION"),
        connectionTimeoutSec: 2
    }

    return cfg;
}