"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
function config() {
    var configData = {
        "TYPESENSE_CONFIG": {
            "nodes": [
                {
                    "host": process.env.TYPESENSE_API_HOST || '',
                    "port": 443,
                    "protocol": "https",
                },
            ],
            apiKey: process.env.TYPESENSE_API_KEY || '',
            "connection_timeout_seconds": 2,
        },
        TYPESENSE_DOCS_COLLECTION: process.env.TYPESENSE_DOCS_COLLECTION || '',
        TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION: process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION || '',
    };
    return configData;
}
exports.config = config;
